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

test('hook-utils classifies build, test, search, polling, and trivial commands', () => {
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
  assert.equal(utils.classifyShellCommand('sleep 15'), 'polling');
  assert.equal(utils.classifyShellCommand('Start-Sleep -Seconds 10'), 'polling');
  assert.equal(utils.classifyShellCommand('timeout /t 10'), 'polling');
  assert.equal(utils.classifyShellCommand('ping -n 5 127.0.0.1'), 'polling');
  assert.equal(utils.classifyShellCommand('timeout 10 npm test'), 'test');
});

test('hook-utils exempts SKILL.md, artifacts, <=300-line bounded reads, and small real files (<=250 lines & <=10 KB)', () => {
  const tmpDir = makeTempStateDir();
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
    utils.isExemptRead({ Path: 'd:\\repo\\src\\big.ts', StartLine: 10, EndLine: 209 }, payload),
    true
  );
  assert.equal(
    utils.isExemptRead({ Path: 'd:\\repo\\src\\big.ts', StartLine: 1, EndLine: 300 }, payload),
    true
  );
  assert.equal(
    utils.isExemptRead({ Path: 'd:\\repo\\src\\big.ts', StartLine: 1, EndLine: 301 }, payload),
    false
  );
  assert.equal(
    utils.isExemptRead({ Path: 'd:\\repo\\src\\big.ts' }, payload),
    false
  );

  // Small real file (120 lines, < 10 KB) is allowed unbounded
  const smallFile = path.join(tmpDir, 'small.ts');
  fs.writeFileSync(smallFile, Array.from({ length: 120 }, (_, i) => `export const v${i} = ${i};`).join('\n'));
  assert.equal(utils.isExemptRead({ Path: smallFile }, payload), true);

  // Large line-count real file (260 lines, < 10 KB) is blocked unbounded with actionable line bounds
  const longLinesFile = path.join(tmpDir, 'many-lines.ts');
  fs.writeFileSync(longLinesFile, Array.from({ length: 260 }, (_, i) => `const a${i} = ${i};`).join('\n'));
  const longCheck = utils.inspectReadRequest({ Path: longLinesFile }, payload);
  assert.equal(longCheck.exempt, false);
  assert.match(longCheck.reason, /260 lines/);
  assert.match(longCheck.reason, /StartLine: 1, EndLine: 250/);

  // Large byte-size real file (50 lines, > 10 KB) is blocked unbounded
  const wideFile = path.join(tmpDir, 'wide.ts');
  fs.writeFileSync(wideFile, Array.from({ length: 50 }, () => 'x'.repeat(250)).join('\n'));
  assert.equal(utils.isExemptRead({ Path: wideFile }, payload), false);
  // Bounded <=300 lines on wideFile (<24 KB slice) is allowed
  assert.equal(utils.isExemptRead({ Path: wideFile, StartLine: 1, EndLine: 50 }, payload), true);

  // Minified single-line mega file (>24 KB on 1 line) is blocked even with StartLine: 1, EndLine: 1
  const minFile = path.join(tmpDir, 'bundle.min.js');
  fs.writeFileSync(minFile, 'a'.repeat(30 * 1024));
  assert.equal(utils.isExemptRead({ Path: minFile, StartLine: 1, EndLine: 1 }, payload), false);

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

test('detectShellEnvironment distinguishes Windows PowerShell 5.1, pwsh 7+, and POSIX shells', () => {
  const ps51 = utils.detectShellEnvironment({}, 'win32');
  assert.equal(ps51.dialect, 'windows-powershell-5.1');
  assert.equal(ps51.supportsAndAnd, false);
  assert.match(ps51.shellHint, /NEVER use '&&'/);
  assert.match(ps51.shellHint, /\$LASTEXITCODE/);
  assert.match(ps51.testHint, /vitest run/);

  const pwsh = utils.detectShellEnvironment(
    { POWERSHELL_DISTRIBUTION_CHANNEL: 'MSI:Windows 10' },
    'win32'
  );
  assert.equal(pwsh.dialect, 'pwsh');
  assert.equal(pwsh.supportsAndAnd, true);

  const linuxBash = utils.detectShellEnvironment({ SHELL: '/bin/bash' }, 'linux');
  assert.equal(linuxBash.dialect, 'bash');
  assert.equal(linuxBash.supportsAndAnd, true);
});

test('session-start initializes root state and emits 3-tier Total-Cost, Zero-Polling, and OS shell contract', () => {
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
  assert.match(msg, /Total Cost/i);
  assert.match(msg, /Zero-Polling/i);
  assert.match(msg, /vitest run/i);
  assert.match(msg, /code-searcher/);
  assert.match(msg, /implementer/);
  assert.match(msg, /fast-editor/);
  assert.match(msg, /verifier/);
  assert.doesNotMatch(msg, /\bbuilder\b/);
  const saved = utils.loadState('root-conv-1', stateDir);
  assert.equal(saved.isSubagent, false);
});

test('pre-tool-gate blocks broad Brain shell calls once (1-shot) and allows retry in soft-gate mode', () => {
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

test('pre-tool-gate avoids turn-wasting hard rejections for soft-gate edits, quick grep_search, and targeted single-file checks', () => {
  const stateDir = makeTempStateDir();
  const env = { PLUGIN_DATA: stateDir };

  assert.equal(
    runHook(
      'scripts/pre-tool-gate.js',
      {
        conversationId: 'conv-soft-direct',
        stepIdx: 1,
        lastUserInput: 'fix bug',
        toolCall: { name: 'edit_file', args: { Path: 'd:/repo/src/lib.rs', Replacement: 'let x = 1;' } },
      },
      env
    ).decision,
    'allow'
  );

  assert.equal(
    runHook(
      'scripts/pre-tool-gate.js',
      {
        conversationId: 'conv-soft-direct',
        stepIdx: 2,
        lastUserInput: 'fix bug',
        toolCall: { name: 'grep_search', args: { Query: 'MyStruct' } },
      },
      env
    ).decision,
    'allow'
  );

  assert.equal(
    runHook(
      'scripts/pre-tool-gate.js',
      {
        conversationId: 'conv-soft-direct',
        stepIdx: 3,
        lastUserInput: 'fix bug',
        toolCall: { name: 'run_command', args: { CommandLine: 'npx vitest run tests/auth.test.ts' } },
      },
      env
    ).decision,
    'allow'
  );

  assert.equal(
    runHook(
      'scripts/pre-tool-gate.js',
      {
        conversationId: 'conv-soft-direct',
        stepIdx: 4,
        lastUserInput: 'fix bug',
        toolCall: { name: 'run_command', args: { CommandLine: 'rg -l "MyStruct" src/' } },
      },
      env
    ).decision,
    'allow'
  );
});

test('pre-tool-gate enforces polling guard persistently against schedule and shell sleep polling, while allowing cron daemons', () => {
  const stateDir = makeTempStateDir();
  const env = { PLUGIN_DATA: stateDir };
  const convId = 'conv-poll-1';

  // Simulate active subagent delegation in this turn
  runHook(
    'scripts/post-tool-track.js',
    {
      conversationId: convId,
      stepIdx: 1,
      lastUserInput: 'build app',
      toolCall: { name: 'invoke_subagent', args: { TypeName: 'code-searcher', Prompt: 'find auth' } },
    },
    env
  );

  const poll1 = runHook(
    'scripts/pre-tool-gate.js',
    {
      conversationId: convId,
      stepIdx: 2,
      lastUserInput: 'build app',
      toolCall: {
        name: 'schedule',
        args: { DurationSeconds: 15, TimerCondition: 'any', Prompt: 'Check subagent status' },
      },
    },
    env
  );
  assert.equal(poll1.decision, 'deny');
  assert.match(poll1.reason, /Zero-Polling/);

  // Repeating or tweaking DurationSeconds must STILL be denied
  const poll2 = runHook(
    'scripts/pre-tool-gate.js',
    {
      conversationId: convId,
      stepIdx: 3,
      lastUserInput: 'build app',
      toolCall: {
        name: 'schedule',
        args: { DurationSeconds: 20, Prompt: 'Wait for worker' },
      },
    },
    env
  );
  assert.equal(poll2.decision, 'deny');

  // Shell sleep polling is denied
  const sleepPoll = runHook(
    'scripts/pre-tool-gate.js',
    {
      conversationId: convId,
      stepIdx: 4,
      lastUserInput: 'build app',
      toolCall: { name: 'run_command', args: { CommandLine: 'Start-Sleep -Seconds 10' } },
    },
    env
  );
  assert.equal(sleepPoll.decision, 'deny');
  assert.match(sleepPoll.reason, /Zero-Polling/);

  // Legitimate recurring cron daemon is allowed
  const cronOk = runHook(
    'scripts/pre-tool-gate.js',
    {
      conversationId: convId,
      stepIdx: 5,
      lastUserInput: 'build app',
      toolCall: {
        name: 'schedule',
        args: { CronExpression: '0 9 * * *', IsDaemon: true, Prompt: 'Daily summary' },
      },
    },
    env
  );
  assert.equal(cronOk.decision, 'allow');
});

test('pre-tool-gate routes build/unbounded-read to consolidated limbs, respects strict & advisory modes, and bypasses subagents', () => {
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
  assert.match(buildRes.reason, /verifier/);

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
  assert.match(readRes.reason, /StartLine: 1, EndLine: 250/);

  const mediumRead = runHook(
    'scripts/pre-tool-gate.js',
    {
      conversationId: 'conv-gate-2',
      stepIdx: 3,
      lastUserInput: 'build',
      toolCall: { name: 'read_file', args: { Path: 'd:/repo/src/app.ts', StartLine: 1, EndLine: 250 } },
    },
    env
  );
  assert.equal(mediumRead.decision, 'allow');

  const strictEnv = { PLUGIN_DATA: stateDir, AGY_EFFICIENCY_MODE: 'strict' };
  const strictSmallPayload = {
    conversationId: 'conv-strict',
    stepIdx: 1,
    lastUserInput: 'edit',
    toolCall: { name: 'edit_file', args: { Path: 'd:/repo/src/a.ts', Replacement: 'const x = 1;' } },
  };
  const strictSmallDeny = runHook('scripts/pre-tool-gate.js', strictSmallPayload, strictEnv);
  assert.equal(strictSmallDeny.decision, 'deny');
  assert.match(strictSmallDeny.reason, /fast-editor/);
  assert.equal(runHook('scripts/pre-tool-gate.js', strictSmallPayload, strictEnv).decision, 'deny');

  const strictLargePayload = {
    conversationId: 'conv-strict',
    stepIdx: 2,
    lastUserInput: 'edit',
    toolCall: {
      name: 'write_file',
      args: {
        Path: 'd:/repo/src/feature.ts',
        Content: Array.from({ length: 45 }, (_, i) => `export const line${i} = ${i};`).join('\n'),
      },
    },
  };
  const strictLargeDeny = runHook('scripts/pre-tool-gate.js', strictLargePayload, strictEnv);
  assert.equal(strictLargeDeny.decision, 'deny');
  assert.match(strictLargeDeny.reason, /implementer/);
  assert.match(strictLargeDeny.reason, /'flash'/);

  assert.equal(
    runHook('scripts/pre-tool-gate.js', strictSmallPayload, {
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
      { ...strictSmallPayload, conversationId: 'sub-conv', transcriptPath: subTranscript },
      strictEnv
    ).decision,
    'allow'
  );
});

test('post-tool-track detects same-file micro-reads, fast-editor -> implementer -> Brain escalation, and high Limb counts', () => {
  const stateDir = makeTempStateDir();
  const env = { PLUGIN_DATA: stateDir };

  // 1) >3 micro-reads on the same file
  const microConv = 'conv-thrash-reads';
  for (let i = 1; i <= 3; i++) {
    runHook(
      'scripts/post-tool-track.js',
      {
        conversationId: microConv,
        stepIdx: i,
        lastUserInput: 'inspect lib.rs',
        toolCall: {
          name: 'read_file',
          args: { Path: 'd:/repo/src/lib.rs', StartLine: (i - 1) * 80 + 1, EndLine: i * 80 },
        },
      },
      env
    );
    assert.equal(utils.loadState(microConv, stateDir).pendingDriftNudge, null);
  }
  runHook(
    'scripts/post-tool-track.js',
    {
      conversationId: microConv,
      stepIdx: 4,
      lastUserInput: 'inspect lib.rs',
      toolCall: {
        name: 'read_file',
        args: { Path: 'd:/repo/src/lib.rs', StartLine: 241, EndLine: 300 },
      },
    },
    env
  );
  const readNudge = utils.loadState(microConv, stateDir).pendingDriftNudge;
  assert.match(readNudge, /300 lines/);
  assert.match(readNudge, /lib\.rs/);

  // 2) >2 fast-editor retries on the same file -> escalate to implementer
  const editConv = 'conv-thrash-fast-edits';
  for (let i = 1; i <= 2; i++) {
    runHook(
      'scripts/post-tool-track.js',
      {
        conversationId: editConv,
        stepIdx: i,
        lastUserInput: 'fix parser',
        toolCall: {
          name: 'invoke_subagent',
          args: { TypeName: 'fast-editor', Prompt: 'TARGET: src/parser.rs:L10-L30' },
        },
      },
      env
    );
    assert.equal(utils.loadState(editConv, stateDir).pendingDriftNudge, null);
  }
  runHook(
    'scripts/post-tool-track.js',
    {
      conversationId: editConv,
      stepIdx: 3,
      lastUserInput: 'fix parser',
      toolCall: {
        name: 'invoke_subagent',
        args: { TypeName: 'fast-editor', Prompt: 'TARGET: src/parser.rs:L10-L30' },
      },
    },
    env
  );
  const fastEditNudge = utils.loadState(editConv, stateDir).pendingDriftNudge;
  assert.match(fastEditNudge, /parser\.rs/);
  assert.match(fastEditNudge, /implementer/);

  // 3) >2 implementer retries on the same file -> Brain takes over directly
  const implConv = 'conv-thrash-impl-edits';
  for (let i = 1; i <= 2; i++) {
    runHook(
      'scripts/post-tool-track.js',
      {
        conversationId: implConv,
        stepIdx: i,
        lastUserInput: 'fix engine',
        toolCall: {
          name: 'invoke_subagent',
          args: { TypeName: 'implementer', Prompt: 'TARGET: src/engine.rs:L40-L120' },
        },
      },
      env
    );
    assert.equal(utils.loadState(implConv, stateDir).pendingDriftNudge, null);
  }
  runHook(
    'scripts/post-tool-track.js',
    {
      conversationId: implConv,
      stepIdx: 3,
      lastUserInput: 'fix engine',
      toolCall: {
        name: 'invoke_subagent',
        args: { TypeName: 'implementer', Prompt: 'TARGET: src/engine.rs:L40-L120' },
      },
    },
    env
  );
  const implNudge = utils.loadState(implConv, stateDir).pendingDriftNudge;
  assert.match(implNudge, /engine\.rs/);
  assert.match(implNudge, /implementer/);
  assert.match(implNudge, /directly/i);

  // 4) >15 Limb spawns in one turn triggers coarse-batching nudge
  const limbConv = 'conv-thrash-limbs';
  for (let i = 1; i <= 16; i++) {
    runHook(
      'scripts/post-tool-track.js',
      {
        conversationId: limbConv,
        stepIdx: i,
        lastUserInput: 'big task',
        toolCall: {
          name: 'invoke_subagent',
          args: { TypeName: 'code-searcher', Prompt: `find symbol_${i}` },
        },
      },
      env
    );
  }
  const limbNudge = utils.loadState(limbConv, stateDir).pendingDriftNudge;
  assert.match(limbNudge, /High Limb count/);
  assert.match(limbNudge, /16/);
});

test('post-tool-track + pre-invocation + stop-verify lifecycle tracks edits, prevents loops, and avoids false Stop rejections', () => {
  const stateDir = makeTempStateDir();
  const env = { PLUGIN_DATA: stateDir };
  const convId = 'conv-lifecycle-1';

  assert.deepEqual(
    runHook(
      'scripts/post-tool-track.js',
      {
        conversationId: convId,
        stepIdx: 10,
        lastUserInput: 'implement feature',
        toolCall: { name: 'invoke_subagent', args: { TypeName: 'fast-editor', Prompt: 'edit src/main.ts' } },
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

  // Same user turn should not fire Stop rejection a second time even if continuationActive were false
  assert.deepEqual(
    runHook(
      'scripts/stop-verify.js',
      {
        conversationId: convId,
        executionNum: 2,
        terminationReason: 'NO_TOOL_CALL',
        fullyIdle: true,
        continuationActive: false,
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
      lastUserInput: 'implement feature',
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

test('stop-verify handles non-source edits, implementer/fast-editor inline & transcript VERIFICATION: PASS, and subsequent mutations', () => {
  const stateDir = makeTempStateDir();
  const env = { PLUGIN_DATA: stateDir };

  // 1) Docs-only edit does NOT require verifier
  const docsConv = 'conv-docs-only';
  runHook(
    'scripts/post-tool-track.js',
    {
      conversationId: docsConv,
      stepIdx: 1,
      lastUserInput: 'update docs',
      toolCall: { name: 'edit_file', args: { Path: 'd:/repo/README.md', Replacement: '# Hi' } },
    },
    env
  );
  assert.equal(utils.loadState(docsConv, stateDir).unverifiedEdits, false);
  assert.deepEqual(
    runHook('scripts/stop-verify.js', { conversationId: docsConv, terminationReason: 'NO_TOOL_CALL' }, env),
    {}
  );

  // 2) Inline edit-and-verify implementer result clears unverifiedEdits
  const inlineConv = 'conv-inline-verify';
  runHook(
    'scripts/post-tool-track.js',
    {
      conversationId: inlineConv,
      stepIdx: 2,
      lastUserInput: 'edit src',
      toolCall: { name: 'invoke_subagent', args: { TypeName: 'implementer', Prompt: 'edit src/a.ts' } },
      toolResponse: 'STATUS: OK\nLOCATIONS:\n- src/a.ts:L1-L50\nVERIFICATION: PASS (npx tsc --noEmit)',
    },
    env
  );
  assert.equal(utils.loadState(inlineConv, stateDir).unverifiedEdits, false);

  // 3) Async transcript verification from implementer after mutation resolves Stop cleanly
  const trConv = 'conv-transcript-verify';
  const trPath = path.join(stateDir, 'tr-verify.jsonl');
  fs.writeFileSync(
    trPath,
    [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT' }),
      JSON.stringify({
        step_index: 5,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        tool_calls: [{ name: 'invoke_subagent', args: { TypeName: 'implementer', Prompt: 'src/x.rs' } }],
      }),
      JSON.stringify({
        step_index: 6,
        source: 'SYSTEM_SDK',
        type: 'GENERIC',
        status: 'DONE',
        content: 'STATUS: OK\nLOCATIONS:\n- src/x.rs:L10-L60\nVERIFICATION: PASS (cargo test x_unit)',
      }),
    ].join('\n') + '\n'
  );
  runHook(
    'scripts/post-tool-track.js',
    {
      conversationId: trConv,
      stepIdx: 5,
      transcriptPath: trPath,
      lastUserInput: 'fix x',
      toolCall: { name: 'invoke_subagent', args: { TypeName: 'implementer', Prompt: 'src/x.rs' } },
    },
    env
  );
  assert.equal(utils.loadState(trConv, stateDir).unverifiedEdits, true);
  assert.deepEqual(
    runHook(
      'scripts/stop-verify.js',
      { conversationId: trConv, transcriptPath: trPath, terminationReason: 'NO_TOOL_CALL' },
      env
    ),
    {}
  );

  // 4) Later implementer mutation AFTER an earlier pass still triggers Stop verification
  const trLateConv = 'conv-transcript-late-mut';
  const trLatePath = path.join(stateDir, 'tr-late-mut.jsonl');
  fs.writeFileSync(
    trLatePath,
    [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT' }),
      JSON.stringify({
        step_index: 4,
        source: 'SYSTEM_SDK',
        type: 'GENERIC',
        status: 'DONE',
        content: 'STATUS: OK\nCOUNTS: passed=5 failed=0 skipped=0',
      }),
      JSON.stringify({
        step_index: 7,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        tool_calls: [{ name: 'invoke_subagent', args: { TypeName: 'implementer', Prompt: 'src/y.rs' } }],
      }),
    ].join('\n') + '\n'
  );
  runHook(
    'scripts/post-tool-track.js',
    {
      conversationId: trLateConv,
      stepIdx: 7,
      transcriptPath: trLatePath,
      lastUserInput: 'update y',
      toolCall: { name: 'invoke_subagent', args: { TypeName: 'implementer', Prompt: 'src/y.rs' } },
    },
    env
  );
  const lateStop = runHook(
    'scripts/stop-verify.js',
    { conversationId: trLateConv, transcriptPath: trLatePath, terminationReason: 'NO_TOOL_CALL' },
    env
  );
  assert.equal(lateStop.decision, 'continue');

  // 5) Failed direct test run (payload.error set) must NOT mark edits verified
  const failConv = 'conv-failed-test';
  runHook(
    'scripts/post-tool-track.js',
    {
      conversationId: failConv,
      stepIdx: 1,
      lastUserInput: 'edit & test',
      toolCall: { name: 'edit_file', args: { Path: 'd:/repo/src/x.ts', Replacement: 'bad' } },
    },
    env
  );
  runHook(
    'scripts/post-tool-track.js',
    {
      conversationId: failConv,
      stepIdx: 2,
      lastUserInput: 'edit & test',
      error: 'exit status 1',
      toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } },
    },
    env
  );
  assert.equal(utils.loadState(failConv, stateDir).unverifiedEdits, true);
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
  assert.match(inv1.injectSteps[0].systemMessage.systemMessage, /verifier/i);

  const inv2 = runHook(
    'scripts/pre-invocation.js',
    { conversationId: convId, invocationNum: 5, initialNumSteps: 5 },
    env
  );
  assert.deepEqual(inv2, {});
});

test('hooks.json configures all 5 lifecycle events cleanly and includes schedule matcher', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks.json'), 'utf8'));
  const cfg = hooks['subagent-efficiency'];
  assert.ok(cfg);
  assert.ok(Array.isArray(cfg.SessionStart) && cfg.SessionStart.length === 1);
  assert.ok(Array.isArray(cfg.PreToolUse) && cfg.PreToolUse.length === 1);
  assert.ok(Array.isArray(cfg.PostToolUse) && cfg.PostToolUse.length === 1);
  assert.ok(Array.isArray(cfg.PreInvocation) && cfg.PreInvocation.length === 1);
  assert.ok(Array.isArray(cfg.Stop) && cfg.Stop.length === 1);
  assert.match(cfg.PreToolUse[0].matcher, /\bschedule\b/);
  assert.match(cfg.PostToolUse[0].matcher, /\bschedule\b/);
});

test('isSubagent handles >4KB first line in transcript.jsonl without truncation', () => {
  const dir = makeTempStateDir();
  const bigPrompt = 'x'.repeat(6000);
  const subTranscript = path.join(dir, 'big-sub.jsonl');
  fs.writeFileSync(
    subTranscript,
    JSON.stringify({ step_index: 0, source: 'SYSTEM', content: bigPrompt }) + '\n'
  );
  assert.equal(utils.isSubagent({ conversationId: 'sub-big', transcriptPath: subTranscript }, {}), true);
});

test('isExemptRead rejects null, empty string, and zero StartLine/EndLine on unknown files', () => {
  const payload = { artifactDirectoryPath: '' };
  assert.equal(
    utils.isExemptRead({ Path: 'd:/repo/src/big.ts', StartLine: null, EndLine: null }, payload),
    false
  );
  assert.equal(
    utils.isExemptRead({ Path: 'd:/repo/src/big.ts', StartLine: '', EndLine: '' }, payload),
    false
  );
  assert.equal(
    utils.isExemptRead({ Path: 'd:/repo/src/big.ts', StartLine: null, EndLine: 79 }, payload),
    false
  );
  assert.equal(
    utils.isExemptRead({ Path: 'd:/repo/src/big.ts', StartLine: 0, EndLine: 10 }, payload),
    false
  );
});

test('classifyShellCommand avoids false positives in git commit args and catches npm/pnpm/yarn run test', () => {
  assert.equal(utils.classifyShellCommand('git commit -m "make tests pass"'), 'other');
  assert.equal(utils.classifyShellCommand('git commit -m "fix jest and eslint"'), 'other');
  assert.equal(utils.classifyShellCommand('npm run test'), 'test');
  assert.equal(utils.classifyShellCommand('pnpm run test:unit'), 'test');
  assert.equal(utils.classifyShellCommand('yarn run test'), 'test');
  assert.equal(utils.classifyShellCommand('NODE_ENV=test npx tsc --noEmit'), 'build');
  assert.equal(utils.classifyShellCommand('git status && npm run build'), 'build');
});

test('post-tool-track tracks IDE grep_search and find_by_name as search drift', () => {
  const stateDir = makeTempStateDir();
  const env = { PLUGIN_DATA: stateDir };
  const convId = 'conv-ide-search';

  assert.deepEqual(
    runHook(
      'scripts/post-tool-track.js',
      { conversationId: convId, stepIdx: 2, toolCall: { name: 'grep_search', args: { Query: 'foo' } } },
      env
    ),
    {}
  );
  let saved = utils.loadState(convId, stateDir);
  assert.equal(saved.directBloatCount, 1);
  assert.match(saved.pendingDriftNudge, /code-searcher/);

  assert.deepEqual(
    runHook(
      'scripts/post-tool-track.js',
      { conversationId: convId, stepIdx: 3, toolCall: { name: 'find_by_name', args: { Pattern: '*.js' } } },
      env
    ),
    {}
  );
  saved = utils.loadState(convId, stateDir);
  assert.equal(saved.directBloatCount, 2);
});

test('session-start skips Brain injection and does not cache false when transcriptPath is absent and lastUserInput is empty', () => {
  const stateDir = makeTempStateDir();
  const out = runHook(
    'scripts/session-start.js',
    {
      conversationId: 'sub-pre-init',
      transcriptPath: path.join(stateDir, 'missing.jsonl'),
      lastUserInput: '',
    },
    { PLUGIN_DATA: stateDir }
  );
  assert.deepEqual(out, {});
  const saved = utils.loadState('sub-pre-init', stateDir);
  assert.equal(saved.isSubagent, null);
});
