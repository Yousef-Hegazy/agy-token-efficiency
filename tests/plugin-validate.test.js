'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

test('plugin.json has v2 metadata, logo, and passes strict validation', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'));
  assert.equal(manifest.$schema, 'https://antigravity.google/schemas/v1/plugin.json');
  assert.equal(manifest.name, 'subagent-efficiency');
  assert.equal(manifest.version, '2.0.0');
  assert.equal(manifest.logo, 'assets/logo.svg');
  assert.ok(Array.isArray(manifest.suggestedPrompts) && manifest.suggestedPrompts.length === 3);
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

test('all 4 native limb agents exist with flash_lite default, inheritCustomizations false, and signal contract', () => {
  const expected = ['code-searcher', 'fast-editor', 'builder', 'verifier'];
  for (const name of expected) {
    const file = path.join(ROOT, 'agents', `${name}.md`);
    assert.ok(fs.existsSync(file), `Missing agents/${name}.md`);
    const content = fs.readFileSync(file, 'utf8');
    assert.match(content, new RegExp(`^name:\\s*${name}\\b`, 'm'));
    assert.match(content, /^subagent:\s*true\b/m);
    assert.match(content, /^mainAgent:\s*false\b/m);
    assert.match(content, /^model:\s*flash_lite\b/m);
    assert.match(content, /^inheritCustomizations:\s*false\b/m);
    assert.match(content, /LOCATIONS:/);
    assert.match(content, /STATUS:/);
  }

  const out = execFileSync('agy', ['plugin', 'validate', '--strict', '--json', ROOT], {
    encoding: 'utf8',
  });
  const report = JSON.parse(out);
  assert.equal(report.components.agents, 4);
  assert.equal(report.components.hooks, 1);
  assert.equal(report.components.rules, 1);
  assert.equal(report.components.skills, 1);
});
