'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const utils = require(path.join(ROOT, 'scripts', 'hook-utils.js'));

function makeTempStateDir() {
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

test('hook-utils classifies build, test, search, and trivial commands', () => {
  assert.equal(utils.classifyShellCommand('npm test'), 'test');
  assert.equal(utils.classifyShellCommand('npx vitest run tests/a.test.js'), 'test');
  assert.equal(utils.classifyShellCommand('pytest -q'), 'test');
  assert.equal(utils.classifyShellCommand('npm run build'), 'build');
  assert.equal(utils.classifyShellCommand('npx tsc --noEmit'), 'build');
  assert.equal(utils.classifyShellCommand('cargo check && eslint .'), 'build');
  assert.equal(utils.classifyShellCommand('rg -n "foo" src/'), 'search');
  assert.equal(utils.classifyShellCommand('Select-String -Pattern bar *.js'), 'search');
  assert.equal(utils.classifyShellCommand('git status -s'), 'trivial');
  assert.equal(utils.classifyShellCommand('pwd'), 'trivial');
});

test('hook-utils exempts SKILL.md, artifacts, and <=80-line bounded reads across Windows/POSIX', () => {
  const payload = {
    artifactDirectoryPath: 'C:\\Users\\GNM\\.gemini\\antigravity\\brain\\conv-1',
  };
  assert.equal(
    utils.isExemptRead({ Path: 'C:\\Users\\GNM\\.gemini\\config\\skills\\foo\\SKILL.md' }, payload),
    true
  );
  assert.equal(
    utils.isExemptRead({ AbsolutePath: '/home/u/.agents/rules/x.md' }, payload),
    true
  );
  assert.equal(
    utils.isExemptRead({ Path: 'd:\\repo\\src\\big.ts', StartLine: 10, EndLine: 89 }, payload),
    true
  );
  assert.equal(
    utils.isExemptRead({ Path: 'd:\\repo\\src\\big.ts', StartLine: 1, EndLine: 200 }, payload),
    false
  );
  assert.equal(
    utils.isExemptRead({ Path: 'd:\\repo\\src\\big.ts' }, payload),
    false
  );
  assert.equal(
    utils.isExemptWrite(
      { Path: 'C:/Users/GNM/.gemini/antigravity/brain/conv-1/implementation_plan.md' },
      payload
    ),
    true
  );
  assert.equal(utils.isExemptWrite({ Path: 'd:/repo/src/index.ts' }, payload), false);
});

test('hook-utils detects subagents via transcript step 0 and state', () => {
  const dir = makeTempStateDir();
  const brainTranscript = path.join(dir, 'brain.jsonl');
  fs.writeFileSync(
    brainTranscript,
    JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT' }) + '\n'
  );
  const subTranscript = path.join(dir, 'sub.jsonl');
  fs.writeFileSync(
    subTranscript,
    JSON.stringify({ step_index: 0, source: 'AGENT', type: 'USER_INPUT' }) + '\n'
  );

  assert.equal(
    utils.isSubagent({ conversationId: 'c1', transcriptPath: brainTranscript }, { isSubagent: false }),
    false
  );
  assert.equal(
    utils.isSubagent({ conversationId: 'c2', transcriptPath: subTranscript }, {}),
    true
  );
  assert.equal(
    utils.isSubagent({ conversationId: 'c3', modelName: 'flash_lite' }, { isSubagent: true }),
    true
  );
});

test('session-start initializes root state and emits Brain & Limbs protocol message', () => {
  const stateDir = makeTempStateDir();
  const transcript = path.join(stateDir, 'root.jsonl');
  fs.writeFileSync(
    transcript,
    JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT' }) + '\n'
  );
  const out = runHook(
    'scripts/session-start.js',
    {
      conversationId: 'root-conv-1',
      transcriptPath: transcript,
      modelName: 'gemini-4-hydrogen-xhigh',
    },
    { PLUGIN_DATA: stateDir }
  );
  assert.ok(Array.isArray(out.injectSteps) && out.injectSteps.length === 1);
  const msg = out.injectSteps[0].systemMessage.systemMessage;
  assert.match(msg, /Brain & Limbs/i);
  assert.match(msg, /code-searcher/);
  assert.match(msg, /fast-editor/);
  assert.match(msg, /builder/);
  assert.match(msg, /verifier/);
  const saved = utils.loadState('root-conv-1', stateDir);
  assert.equal(saved.isSubagent, false);
});

test('pre-tool-gate blocks high-bloat Brain calls once (1-shot) and allows retry in soft-gate mode', () => {
  const stateDir = makeTempStateDir();
  const payload = {
    conversationId: 'conv-gate-1',
    stepIdx: 5,
    lastUserInput: 'run tests',
    toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } },
  };

  const first = runHook('scripts/pre-tool-gate.js', payload, { PLUGIN_DATA: stateDir });
  assert.equal(first.decision, 'deny');
  assert.match(first.reason, /verifier/);

  const second = runHook('scripts/pre-tool-gate.js', payload, { PLUGIN_DATA: stateDir });
  assert.equal(second.decision, 'allow');
});

test('pre-tool-gate routes build/search/edit/unbounded-read to exact limbs, respects strict & advisory modes, and bypasses subagents', () => {
  const stateDir = makeTempStateDir();
  const env = { PLUGIN_DATA: stateDir };

  const buildRes = runHook(
    'scripts/pre-tool-gate.js',
    {
      conversationId: 'conv-gate-2',
      stepIdx: 1,
      lastUserInput: 'build',
      toolCall: { name: 'run_command', args: { CommandLine: 'npx tsc --noEmit' } },
    },
    env
  );
  assert.equal(buildRes.decision, 'deny');
  assert.match(buildRes.reason, /builder/);

  const readRes = runHook(
    'scripts/pre-tool-gate.js',
    {
      conversationId: 'conv-gate-2',
      stepIdx: 2,
      lastUserInput: 'build',
      toolCall: { name: 'read_file', args: { Path: 'd:/repo/src/app.ts' } },
    },
    env
  );
  assert.equal(readRes.decision, 'deny');
  assert.match(readRes.reason, /code-searcher/);

  const smallRead = runHook(
    'scripts/pre-tool-gate.js',
    {
      conversationId: 'conv-gate-2',
      stepIdx: 3,
      lastUserInput: 'build',
      toolCall: { name: 'read_file', args: { Path: 'd:/repo/src/app.ts', StartLine: 1, EndLine: 50 } },
    },
    env
  );
  assert.equal(smallRead.decision, 'allow');

  const strictEnv = { PLUGIN_DATA: stateDir, AGY_EFFICIENCY_MODE: 'strict' };
  const strictPayload = {
    conversationId: 'conv-strict',
    stepIdx: 1,
    lastUserInput: 'edit',
    toolCall: { name: 'edit_file', args: { Path: 'd:/repo/src/a.ts' } },
  };
  assert.equal(runHook('scripts/pre-tool-gate.js', strictPayload, strictEnv).decision, 'deny');
  assert.equal(runHook('scripts/pre-tool-gate.js', strictPayload, strictEnv).decision, 'deny');

  assert.equal(
    runHook('scripts/pre-tool-gate.js', strictPayload, {
      PLUGIN_DATA: stateDir,
      AGY_EFFICIENCY_MODE: 'advisory',
    }).decision,
    'allow'
  );

  const subTranscript = path.join(stateDir, 'sub-gate.jsonl');
  fs.writeFileSync(
    subTranscript,
    JSON.stringify({ step_index: 0, source: 'AGENT', type: 'USER_INPUT' }) + '\n'
  );
  assert.equal(
    runHook(
      'scripts/pre-tool-gate.js',
      { ...strictPayload, conversationId: 'sub-conv', transcriptPath: subTranscript },
      strictEnv
    ).decision,
    'allow'
  );
});

test('post-tool-track + pre-invocation + stop-verify lifecycle tracks edits and prevents loops', () => {
  const stateDir = makeTempStateDir();
  const env = { PLUGIN_DATA: stateDir };
  const convId = 'conv-lifecycle-1';

  assert.deepEqual(
    runHook(
      'scripts/post-tool-track.js',
      {
        conversationId: convId,
        stepIdx: 10,
        toolCall: { name: 'invoke_subagent', args: { TypeName: 'fast-editor' } },
      },
      env
    ),
    {}
  );
  assert.equal(utils.loadState(convId, stateDir).unverifiedEdits, true);

  const stop1 = runHook(
    'scripts/stop-verify.js',
    {
      conversationId: convId,
      executionNum: 1,
      terminationReason: 'NO_TOOL_CALL',
      fullyIdle: true,
      continuationActive: false,
    },
    env
  );
  assert.equal(stop1.decision, 'continue');
  assert.match(stop1.reason, /verifier/);

  assert.deepEqual(
    runHook(
      'scripts/stop-verify.js',
      {
        conversationId: convId,
        executionNum: 2,
        terminationReason: 'NO_TOOL_CALL',
        fullyIdle: true,
        continuationActive: true,
      },
      env
    ),
    {}
  );

  assert.deepEqual(
    runHook(
      'scripts/stop-verify.js',
      {
        conversationId: convId,
        executionNum: 1,
        terminationReason: 'USER_CANCELED',
        fullyIdle: true,
        continuationActive: false,
      },
      env
    ),
    {}
  );

  runHook(
    'scripts/post-tool-track.js',
    {
      conversationId: convId,
      stepIdx: 11,
      toolCall: { name: 'invoke_subagent', args: { TypeName: 'verifier' } },
    },
    env
  );
  assert.equal(utils.loadState(convId, stateDir).unverifiedEdits, false);
  assert.deepEqual(
    runHook(
      'scripts/stop-verify.js',
      {
        conversationId: convId,
        executionNum: 1,
        terminationReason: 'NO_TOOL_CALL',
        fullyIdle: true,
        continuationActive: false,
      },
      env
    ),
    {}
  );
});

test('pre-invocation emits drift nudge at most once and clears flag immediately', () => {
  const stateDir = makeTempStateDir();
  const env = { PLUGIN_DATA: stateDir };
  const convId = 'conv-nudge-1';

  runHook(
    'scripts/post-tool-track.js',
    {
      conversationId: convId,
      stepIdx: 3,
      toolCall: { name: 'run_command', args: { CommandLine: 'npm run build' } },
    },
    env
  );

  const inv1 = runHook(
    'scripts/pre-invocation.js',
    { conversationId: convId, invocationNum: 4, initialNumSteps: 4 },
    env
  );
  assert.ok(Array.isArray(inv1.injectSteps) && inv1.injectSteps.length === 1);
  assert.match(inv1.injectSteps[0].systemMessage.systemMessage, /builder/i);

  const inv2 = runHook(
    'scripts/pre-invocation.js',
    { conversationId: convId, invocationNum: 5, initialNumSteps: 5 },
    env
  );
  assert.deepEqual(inv2, {});
});

test('hooks.json configures all 5 lifecycle events cleanly', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks.json'), 'utf8'));
  const cfg = hooks['subagent-efficiency'];
  assert.ok(cfg);
  assert.ok(Array.isArray(cfg.SessionStart) && cfg.SessionStart.length === 1);
  assert.ok(Array.isArray(cfg.PreToolUse) && cfg.PreToolUse.length === 1);
  assert.ok(Array.isArray(cfg.PostToolUse) && cfg.PostToolUse.length === 1);
  assert.ok(Array.isArray(cfg.PreInvocation) && cfg.PreInvocation.length === 1);
  assert.ok(Array.isArray(cfg.Stop) && cfg.Stop.length === 1);
});
