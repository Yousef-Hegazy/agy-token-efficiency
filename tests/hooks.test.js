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
