'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

test('plugin.json has 3-tier v2 metadata, logo, no stale builder references, and passes strict validation', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'));
  assert.equal(manifest.$schema, 'https://antigravity.google/schemas/v1/plugin.json');
  assert.equal(manifest.name, 'subagent-efficiency');
  assert.equal(manifest.version, '2.0.0');
  assert.equal(manifest.logo, 'assets/logo.svg');
  assert.ok(Array.isArray(manifest.suggestedPrompts) && manifest.suggestedPrompts.length === 3);
  assert.ok(!manifest.suggestedPrompts.some((p) => /\bbuilder\b/i.test(p)));
  assert.ok(fs.existsSync(path.join(ROOT, manifest.logo)));

  const out = execFileSync('agy', ['plugin', 'validate', '--strict', '--json', ROOT], {
    encoding: 'utf8',
  });
  const report = JSON.parse(out);
  const issues = (report.findings || []).filter(
    (f) => f.severity === 'error' || f.severity === 'warning'
  );
  assert.deepEqual(issues, []);
});

test('3-tier agent roster exists (implementer on flash; searcher, mechanical fast-editor, consolidated verifier on flash_lite) and builder.md is removed', () => {
  assert.equal(
    fs.existsSync(path.join(ROOT, 'agents', 'builder.md')),
    false,
    'agents/builder.md must be deleted'
  );

  const roster = [
    { name: 'code-searcher', model: 'flash_lite' },
    { name: 'fast-editor', model: 'flash_lite' },
    { name: 'implementer', model: 'flash' },
    { name: 'verifier', model: 'flash_lite' },
  ];

  for (const { name, model } of roster) {
    const file = path.join(ROOT, 'agents', `${name}.md`);
    assert.ok(fs.existsSync(file), `Missing agents/${name}.md`);
    const content = fs.readFileSync(file, 'utf8');
    assert.match(content, new RegExp(`^name:\\s*${name}\\b`, 'm'));
    assert.match(content, /^subagent:\s*true\b/m);
    assert.match(content, /^mainAgent:\s*false\b/m);
    assert.match(content, new RegExp(`^model:\\s*${model}\\b`, 'm'));
    assert.match(content, /^inheritCustomizations:\s*false\b/m);
    assert.match(content, /LOCATIONS:/);
    assert.match(content, /STATUS:/);
    assert.match(content, /PowerShell/i);
  }

  const searcher = fs.readFileSync(path.join(ROOT, 'agents', 'code-searcher.md'), 'utf8');
  assert.match(searcher, /SIGNATURES_AND_IMPORTS:/);
  assert.match(searcher, /6–8/);

  const implementer = fs.readFileSync(path.join(ROOT, 'agents', 'implementer.md'), 'utf8');
  assert.match(implementer, /^\s*-\s*edit_file\b/m);
  assert.match(implementer, /^\s*-\s*write_file\b/m);
  assert.match(implementer, /^\s*-\s*run_command\b/m);
  assert.match(implementer, /VERIFICATION:/);
  assert.match(implementer, /15–20/);
  assert.match(implementer, /PowerShell 5\.1/i);

  const editor = fs.readFileSync(path.join(ROOT, 'agents', 'fast-editor.md'), 'utf8');
  assert.match(editor, /^\s*-\s*run_command\b/m);
  assert.match(editor, /VERIFICATION:/);
  assert.match(editor, /strictly mechanical/i);
  assert.match(editor, /implementer/i);
  assert.match(editor, /Escalate-Fast/i);
  assert.match(editor, /PowerShell 5\.1/i);

  const verifier = fs.readFileSync(path.join(ROOT, 'agents', 'verifier.md'), 'utf8');
  assert.match(verifier, /vitest run/);
  assert.match(verifier, /tsc --noEmit/);
  assert.match(verifier, /15–20/);
  assert.match(verifier, /PowerShell 5\.1/i);

  const out = execFileSync('agy', ['plugin', 'validate', '--strict', '--json', ROOT], {
    encoding: 'utf8',
  });
  const report = JSON.parse(out);
  assert.equal(report.components.agents, 4);
  assert.equal(report.components.hooks, 1);
  assert.equal(report.components.rules, 1);
  assert.equal(report.components.skills, 1);
});

test('rules/AGENTS.md and SKILL.md document the 3-tier routing matrix without stale builder references', () => {
  const rulesText = fs.readFileSync(path.join(ROOT, 'rules', 'AGENTS.md'), 'utf8');
  for (const token of [
    'code-searcher',
    'implementer',
    'fast-editor',
    'verifier',
    'exact_lines',
    'Red Flags',
    'Total Cost',
    'Zero-Polling',
    '300',
    '10–15',
    '3-Tier',
  ]) {
    assert.ok(rulesText.includes(token), `rules/AGENTS.md missing ${token}`);
  }
  assert.doesNotMatch(rulesText, /\bbuilder\b/i);

  const skillText = fs.readFileSync(
    path.join(ROOT, 'skills', 'subagent-efficiency', 'SKILL.md'),
    'utf8'
  );
  assert.match(skillText, /^description:\s*>-?\s*\n\s*Use when /m);
  for (const token of [
    'code-searcher',
    'implementer',
    'fast-editor',
    'verifier',
    'DETAIL_LEVEL',
    'Total Cost',
    'Zero-Polling',
    '300',
    '3-Tier',
  ]) {
    assert.ok(skillText.includes(token), `SKILL.md missing ${token}`);
  }
  assert.doesNotMatch(skillText, /\bbuilder\b/i);
});
