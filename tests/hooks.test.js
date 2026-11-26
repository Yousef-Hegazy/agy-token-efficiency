'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agy-eff-test-'));
}

function runHook(scriptRelPath, payload, envExtra = {}) {
  const res = spawnSync(process.execPath, [path.join(ROOT, scriptRelPath)], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...envExtra },
  });
  assert.equal(res.status, 0, `Hook ${scriptRelPath} exited ${res.status}: ${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

function makeTranscript(dir, name, source) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify({ step_index: 0, source, type: 'USER_INPUT' }) + '\n');
  return p;
}

test('manage_task(status) is blocked for BOTH Brain and subagents; kill/list/send_input pass', () => {
  const dir = makeTempDir();
  const brainT = makeTranscript(dir, 'brain.jsonl', 'USER_EXPLICIT');
  const subT = makeTranscript(dir, 'sub.jsonl', 'AGENT');

  for (const transcriptPath of [brainT, subT]) {
    for (const args of [{ Action: 'status', TaskId: 't1' }, { action: 'status', TaskId: 't1' }]) {
      const out = runHook('scripts/pre-tool-gate.js', {
        transcriptPath,
        toolCall: { name: 'manage_task', args },
      });
      assert.equal(out.decision, 'deny');
      assert.match(out.reason, /^POLLING BLOCKED:/);
    }
    for (const Action of ['list', 'kill', 'send_input']) {
      const out = runHook('scripts/pre-tool-gate.js', {
        transcriptPath,
        toolCall: { name: 'manage_task', args: { Action, TaskId: 't1' } },
      });
      assert.equal(out.decision, 'allow');
    }
  }
});

test('schedule one-shot timers and shell sleep polling are blocked; cron daemons and normal commands pass', () => {
  const dir = makeTempDir();
  const subT = makeTranscript(dir, 'sub.jsonl', 'AGENT');

  // One-shot schedule blocked for both Brain and subagent
  for (const transcriptPath of [undefined, subT]) {
    const out = runHook('scripts/pre-tool-gate.js', {
      transcriptPath,
      toolCall: { name: 'schedule', args: { DurationSeconds: 15, Prompt: 'check progress' } },
    });
    assert.equal(out.decision, 'deny');
    assert.match(out.reason, /^POLLING BLOCKED:/);
  }

  // Recurring cron daemon allowed
  const cron = runHook('scripts/pre-tool-gate.js', {
    toolCall: {
      name: 'schedule',
      args: { CronExpression: '*/5 * * * *', IsDaemon: true, Prompt: 'daily digest' },
    },
  });
  assert.equal(cron.decision, 'allow');

  // Shell sleep polling blocked for Brain and subagent
  for (const cmd of ['sleep 10', 'Start-Sleep -Seconds 5', 'timeout /t 10', 'ping -n 5 127.0.0.1']) {
    const out = runHook('scripts/pre-tool-gate.js', {
      transcriptPath: subT,
      toolCall: { name: 'run_command', args: { CommandLine: cmd } },
    });
    assert.equal(out.decision, 'deny', `Expected deny for: ${cmd}`);
    assert.match(out.reason, /^POLLING BLOCKED:/);
  }

  // Normal run_command allowed
  for (const cmd of ['npm test', 'git status -s', 'timeout 10 npm test']) {
    const out = runHook('scripts/pre-tool-gate.js', {
      toolCall: { name: 'run_command', args: { CommandLine: cmd } },
    });
    assert.equal(out.decision, 'allow', `Expected allow for: ${cmd}`);
  }
});

test('Brain read gate allows <=300-line bounded reads and small files (<=250 lines & <=10 KB); blocks large unbounded reads', () => {
  const dir = makeTempDir();
  const subT = makeTranscript(dir, 'sub.jsonl', 'AGENT');

  const smallFile = path.join(dir, 'small.ts');
  fs.writeFileSync(smallFile, Array.from({ length: 120 }, (_, i) => `export const v${i} = ${i};`).join('\n'));
  assert.equal(
    runHook('scripts/pre-tool-gate.js', { toolCall: { name: 'read_file', args: { Path: smallFile } } }).decision,
    'allow'
  );

  const largeFile = path.join(dir, 'large.ts');
  fs.writeFileSync(largeFile, Array.from({ length: 280 }, (_, i) => `export const v${i} = ${i};`).join('\n'));

  // Unbounded read on large file blocked for Brain
  const unbounded = runHook('scripts/pre-tool-gate.js', {
    toolCall: { name: 'read_file', args: { Path: largeFile } },
  });
  assert.equal(unbounded.decision, 'deny');
  assert.match(unbounded.reason, /StartLine: 1, EndLine: 250/);

  // Bounded <=300 lines allowed for Brain
  assert.equal(
    runHook('scripts/pre-tool-gate.js', {
      toolCall: { name: 'read_file', args: { Path: largeFile, StartLine: 1, EndLine: 280 } },
    }).decision,
    'allow'
  );

  // Bounded >300 lines blocked for Brain
  assert.equal(
    runHook('scripts/pre-tool-gate.js', {
      toolCall: { name: 'read_file', args: { Path: largeFile, StartLine: 1, EndLine: 301 } },
    }).decision,
    'deny'
  );

  // Subagent can read large file unbounded
  assert.equal(
    runHook('scripts/pre-tool-gate.js', {
      transcriptPath: subT,
      toolCall: { name: 'read_file', args: { Path: largeFile } },
    }).decision,
    'allow'
  );
});

test('edit_file, write_file, grep_search, and malformed stdin fail-open to allow', () => {
  for (const name of ['edit_file', 'write_file', 'grep_search', 'find_by_name']) {
    const out = runHook('scripts/pre-tool-gate.js', {
      toolCall: { name, args: { Path: 'src/index.ts' } },
    });
    assert.equal(out.decision, 'allow');
  }
  const bad = runHook('scripts/pre-tool-gate.js', '{not-valid-json');
  assert.equal(bad.decision, 'allow');
});

test('session-start emits OS/shell & 2-Limb banner for Brain and skips subagents', () => {
  const dir = makeTempDir();
  const brainT = makeTranscript(dir, 'brain.jsonl', 'USER_EXPLICIT');
  const subT = makeTranscript(dir, 'sub.jsonl', 'AGENT');

  const out = runHook('scripts/session-start.js', { transcriptPath: brainT });
  assert.ok(Array.isArray(out.injectSteps) && out.injectSteps.length === 1);
  const msg = out.injectSteps[0].systemMessage.systemMessage;
  assert.match(msg, /2 I\/O Limbs/);
  assert.match(msg, /code-searcher/);
  assert.match(msg, /verifier/);
  assert.match(msg, /\/effort medium/);
  assert.match(msg, /Zero-Polling/i);

  const subOut = runHook('scripts/session-start.js', { transcriptPath: subT });
  assert.deepEqual(subOut, {});
});
