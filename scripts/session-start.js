#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function readStdin(ms = 500) {
  return new Promise((res) => {
    let buf = '', done = false;
    const end = () => { if (done) return; done = true; try { res(buf.trim() ? JSON.parse(buf) : {}); } catch { res({}); } };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', end);
    process.stdin.on('error', end);
    const t = setTimeout(end, ms);
    if (t.unref) t.unref();
  });
}

function isSubagent(p) {
  try {
    if (!p || !fs.existsSync(p)) return false;
    const line = fs.readFileSync(p, 'utf8').split(/\r?\n/, 1)[0].trim();
    const first = line ? JSON.parse(line) : null;
    return Boolean(first && first.source && first.source !== 'USER_EXPLICIT');
  } catch { return false; }
}

function getShellHint() {
  const sh = String(process.env.SHELL || process.env.AGY_SHELL || '').trim();
  if (process.platform === 'win32' && !/(?:bash|zsh|sh|fish|pwsh)(?:\.exe)?$/i.test(sh) && !process.env.POWERSHELL_DISTRIBUTION_CHANNEL) {
    return '[Env] OS=win32 | Windows PowerShell 5.1: NEVER use `&&`; chain with `; if ($LASTEXITCODE -eq 0) { ... }`.';
  }
  const label = sh ? path.posix.basename(sh.replace(/\\/g, '/')) : (process.platform === 'win32' ? 'pwsh' : 'sh/bash');
  return `[Env] OS=${process.platform} | Shell=${label}: '&&' supported.`;
}

(async () => {
  const payload = await readStdin();
  if (isSubagent(payload.transcriptPath)) return process.stdout.write('{}');
  const msg = [
    '[Brain & Limbs — Brain + 2 I/O Limbs]',
    '- Brain edits directly on warm cache (use `/effort medium` during implementation); bounded reads <=300 lines (or small files <=250 lines / 10 KB).',
    '- `code-searcher` (`flash_lite`, <=2-3 runs): broad recon & >300-line files; `verifier` (`flash_lite`): noisy build/test/coverage runs.',
    '- Zero-Polling: NEVER poll `manage_task(status)`, `schedule`, or `sleep`—end turn and wait for automatic wakeup.',
    `- ${getShellHint()}`,
  ].join('\n');
  process.stdout.write(JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: msg } }] }));
})().catch(() => process.stdout.write('{}'));
