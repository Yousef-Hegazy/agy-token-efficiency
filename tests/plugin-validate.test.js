'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

test('plugin.json and hooks.json match stateless 2-hook / 2-Limb design and pass strict validation', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'));
  assert.equal(manifest.$schema, 'https://antigravity.google/schemas/v1/plugin.json');
  assert.equal(manifest.name, 'subagent-efficiency');
  assert.equal(manifest.version, '2.0.0');
  assert.ok(fs.existsSync(path.join(ROOT, manifest.logo)));

  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks.json'), 'utf8'));
  const events = Object.keys(hooks['subagent-efficiency']).sort();
  assert.deepEqual(events, ['PreToolUse', 'SessionStart']);

  const out = execFileSync('agy', ['plugin', 'validate', '--strict', '--json', ROOT], {
    encoding: 'utf8',
  });
  const report = JSON.parse(out);
  const issues = (report.findings || []).filter(
    (f) => f.severity === 'error' || f.severity === 'warning'
  );
  assert.deepEqual(issues, []);
  assert.equal(report.components.agents, 2);
  assert.equal(report.components.hooks, 1);
  assert.equal(report.components.rules, 1);
  assert.equal(report.components.skills, 1);
});

test('2-Limb agent roster (code-searcher and verifier on flash_lite) includes async end-turn, sequential cargo, and verbatim metrics rules', () => {
  const searcher = fs.readFileSync(path.join(ROOT, 'agents', 'code-searcher.md'), 'utf8');
  assert.match(searcher, /^name:\s*code-searcher\b/m);
  assert.match(searcher, /^model:\s*flash_lite\b/m);
  assert.match(searcher, /SIGNATURES_AND_IMPORTS:/);

  const verifier = fs.readFileSync(path.join(ROOT, 'agents', 'verifier.md'), 'utf8');
  assert.match(verifier, /^name:\s*verifier\b/m);
  assert.match(verifier, /^model:\s*flash_lite\b/m);
  assert.match(verifier, /WaitMsBeforeAsync/);
  assert.match(verifier, /manage_task\(Action:\s*"status"\)/);
  assert.match(verifier, /cargo/i);
  assert.match(verifier, /VERBATIM_SUMMARY:/);
});

test('rules/AGENTS.md, SKILL.md, and README.md have no stale stateful hook references', () => {
  for (const rel of ['rules/AGENTS.md', 'skills/subagent-efficiency/SKILL.md', 'README.md']) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(text, /\b(?:stop-verify|post-tool-track|pre-invocation|soft-gate)\b/i, rel);
  }
});
