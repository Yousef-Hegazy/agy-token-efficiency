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
