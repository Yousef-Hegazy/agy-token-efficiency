#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const POLL_MSG =
  'POLLING BLOCKED: Never poll manage_task(status), schedule, or sleep. End your turn immediately with NO tool calls—Antigravity will automatically wake you when the background task finishes.';
const POLL_CMD_RE = /^(?:sleep|start-sleep|usleep)\b|^timeout\s+\/t\b|^ping\s+-n\s+\d+\s+(?:127\.0\.0\.1|localhost)\b/i;

const allow = () => { process.stdout.write('{"decision":"allow"}'); process.exit(0); };
const deny = (reason) => { process.stdout.write(JSON.stringify({ decision: 'deny', reason })); process.exit(0); };

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
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, 4096, 0);
      const line = buf.subarray(0, n).toString('utf8').split(/\r?\n/, 1)[0].trim();
      const first = line ? JSON.parse(line) : null;
      return Boolean(first && first.source && first.source !== 'USER_EXPLICIT');
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

function hasPollingShell(cmd) {
  return String(cmd || '').split(/&&|\|\||[;|\r\n]+/).some((seg) => {
    const clean = seg.trim().replace(/^(?:[A-Za-z_]\w*=\S+\s+|cmd\s+\/c\s+)/i, '');
    return POLL_CMD_RE.test(clean);
  });
}

function norm(p) { return String(p || '').replace(/^[A-Za-z]:/, '').replace(/\\/g, '/').toLowerCase(); }

function checkRead(args = {}, payload = {}) {
  if (args.IsSkillFile === true) return null;
  const raw = args.Path || args.AbsolutePath || args.TargetFile || args.path || '';
  const nf = norm(raw);
  if (!nf) return 'Missing target file path for read_file.';
  const art = norm(payload.artifactDirectoryPath);
  if (nf.endsWith('/skill.md') || /\/(?:\.gemini|\.agents?)\//.test(nf) || (art && (nf === art || nf.startsWith(`${art}/`)))) return null;

  const label = path.basename(raw) || raw;
  const hasStart = args.StartLine != null && args.StartLine !== '';
  const hasEnd = args.EndLine != null && args.EndLine !== '';
  let stat = null, text = null, lines = null;
  try {
    if (fs.existsSync(raw) && (stat = fs.statSync(raw)).isFile() && stat.size <= 2 * 1024 * 1024) {
      text = fs.readFileSync(raw, 'utf8');
      lines = text ? text.replace(/\r?\n$/, '').split(/\r?\n/).length : 0;
    }
  } catch { stat = null; }

  if (hasStart || hasEnd) {
    const s = Number(args.StartLine), e = Number(args.EndLine);
    if (!hasStart || !hasEnd || !Number.isInteger(s) || !Number.isInteger(e) || s < 1 || e < s) {
      return `Invalid line range for '${label}'. Provide StartLine >= 1 and EndLine >= StartLine (<= 300 lines, e.g. StartLine: 1, EndLine: 250).`;
    }
    if (e - s + 1 > 300) {
      return `Requested range (${e - s + 1} lines) on '${label}' exceeds 300-line cap. Narrow to StartLine: ${s}, EndLine: ${s + 299} or use 'code-searcher'.`;
    }
    if (text && Buffer.byteLength(text.replace(/\r?\n$/, '').split(/\r?\n/).slice(s - 1, e).join('\n'), 'utf8') > 24 * 1024) {
      return `Requested slice on '${label}' exceeds 24 KB (minified/wide lines). Narrow range (e.g. StartLine: ${s}, EndLine: ${s + 39}) or use 'code-searcher'.`;
    }
    return null;
  }

  if (stat && stat.size <= 10 * 1024 && lines !== null && lines <= 250) return null;
  const recEnd = lines !== null ? Math.min(lines, 250) : 250;
  return `Unbounded read on '${label}'${stat ? ` (${lines ?? '?'} lines, ${(stat.size / 1024).toFixed(1)} KB)` : ''} exceeds 250 lines / 10 KB. Use StartLine: 1, EndLine: ${recEnd} or delegate to 'code-searcher'.`;
}

(async () => {
  try {
    const payload = await readStdin();
    const tc = payload.toolCall || {};
    const name = tc.name || '';
    const args = tc.args || {};

    // Gate 1: Zero-Polling (Brain AND all Limbs)
    if (name === 'manage_task' && String(args.Action || args.action || '').toLowerCase() === 'status') return deny(POLL_MSG);
    if (name === 'schedule' && !(typeof args.CronExpression === 'string' && args.CronExpression.trim()) && args.IsDaemon !== true) return deny(POLL_MSG);
    if (name === 'run_command' && hasPollingShell(args.CommandLine || args.commandLine || '')) return deny(POLL_MSG);

    // Gate 2: Large Unbounded Read (Brain only)
    if ((name === 'read_file' || name === 'view_file') && !isSubagent(payload.transcriptPath)) {
      const err = checkRead(args, payload);
      if (err) return deny(err);
    }
    return allow();
  } catch { return allow(); }
})().catch(allow);
