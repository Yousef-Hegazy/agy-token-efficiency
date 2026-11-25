'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const VALID_MODES = new Set(['advisory', 'soft-gate', 'strict']);

function emitJson(obj) {
  process.stdout.write(JSON.stringify(obj || {}));
  process.exit(0);
}

function readStdinJson(timeoutMs = 500) {
  return new Promise((resolve) => {
    let buffer = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (!buffer.trim()) return resolve({});
      try {
        resolve(JSON.parse(buffer));
      } catch {
        resolve({});
      }
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    const timer = setTimeout(finish, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

function getStateDir() {
  const base =
    process.env.PLUGIN_DATA && process.env.PLUGIN_DATA.trim()
      ? process.env.PLUGIN_DATA.trim()
      : path.join(os.tmpdir(), 'agy-subagent-efficiency');
  try {
    fs.mkdirSync(base, { recursive: true });
  } catch {
    // Fail-open
  }
  return base;
}

function getMode(stateDir = getStateDir()) {
  const envMode = (process.env.AGY_EFFICIENCY_MODE || '').trim().toLowerCase();
  if (VALID_MODES.has(envMode)) return envMode;
  try {
    const cfgPath = path.join(stateDir, 'config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      const cfgMode = typeof cfg.mode === 'string' ? cfg.mode.trim().toLowerCase() : '';
      if (VALID_MODES.has(cfgMode)) return cfgMode;
    }
  } catch {
    // Ignore invalid config
  }
  return 'soft-gate';
}

function stateFilePath(conversationId, stateDir = getStateDir()) {
  const safeId = String(conversationId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(stateDir, `state-${safeId}.json`);
}

function defaultState(conversationId) {
  return {
    conversationId: conversationId || 'default',
    isSubagent: null,
    unverifiedEdits: false,
    buildChecked: false,
    directBloatCount: 0,
    delegatedCalls: 0,
    pendingDriftNudge: null,
    warnedSignatures: {},
    stopWarnedAtStep: null,
    lastStepIdx: -1,
    lastUserInput: '',
  };
}

function loadState(conversationId, stateDir = getStateDir()) {
  const file = stateFilePath(conversationId, stateDir);
  try {
    if (fs.existsSync(file)) {
      return { ...defaultState(conversationId), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
  } catch {
    // Fall back to clean state
  }
  return defaultState(conversationId);
}

function saveState(conversationId, state, stateDir = getStateDir()) {
  const file = stateFilePath(conversationId, stateDir);
  try {
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {
    // Fail-open
  }
}

function normalizePath(p) {
  if (!p || typeof p !== 'string') return '';
  return p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/').toLowerCase();
}

function readTranscriptFirstLine(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') return null;
  try {
    if (!fs.existsSync(transcriptPath)) return null;
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const chunkSize = 4096;
      const maxBytes = 512 * 1024;
      const chunks = [];
      let total = 0;
      while (total < maxBytes) {
        const buf = Buffer.alloc(chunkSize);
        const bytes = fs.readSync(fd, buf, 0, chunkSize, total);
        if (bytes <= 0) break;
        const slice = bytes < chunkSize ? buf.subarray(0, bytes) : buf;
        const nlIdx = slice.indexOf(0x0a);
        if (nlIdx !== -1) {
          chunks.push(slice.subarray(0, nlIdx));
          break;
        }
        chunks.push(slice);
        total += bytes;
      }
      if (chunks.length === 0) return null;
      const firstLine = Buffer.concat(chunks).toString('utf8').replace(/\r$/, '').trim();
      return firstLine ? JSON.parse(firstLine) : null;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function isSubagent(payload, state = {}) {
  if (state && state.isSubagent === true) return true;
  const first = readTranscriptFirstLine(payload && payload.transcriptPath);
  if (first && first.source && first.source !== 'USER_EXPLICIT') {
    return true;
  }
  return false;
}

function extractTargetPath(args = {}) {
  return args.Path || args.AbsolutePath || args.TargetFile || args.path || '';
}

function isUnderDir(normFile, normDir) {
  if (!normFile || !normDir) return false;
  const cleanDir = normDir.endsWith('/') ? normDir.slice(0, -1) : normDir;
  return normFile === cleanDir || normFile.startsWith(`${cleanDir}/`);
}

function isExemptRead(args = {}, payload = {}) {
  if (args.IsSkillFile === true) return true;
  const normFile = normalizePath(extractTargetPath(args));
  if (!normFile) return false;
  if (
    normFile.endsWith('/skill.md') ||
    normFile.includes('/.gemini/') ||
    normFile.includes('/.agents/') ||
    normFile.includes('/.agent/')
  ) {
    return true;
  }
  const artifactDir = normalizePath(payload.artifactDirectoryPath || '');
  if (isUnderDir(normFile, artifactDir)) return true;

  if (
    args.StartLine != null &&
    args.StartLine !== '' &&
    args.EndLine != null &&
    args.EndLine !== ''
  ) {
    const start = Number(args.StartLine);
    const end = Number(args.EndLine);
    if (
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 1 &&
      end >= start &&
      end - start + 1 <= 80
    ) {
      return true;
    }
  }
  return false;
}

function isExemptWrite(args = {}, payload = {}) {
  const normFile = normalizePath(extractTargetPath(args));
  if (!normFile) return false;
  const artifactDir = normalizePath(payload.artifactDirectoryPath || '');
  if (isUnderDir(normFile, artifactDir)) return true;
  if (normFile.includes('/.gemini/antigravity') && normFile.includes('/brain/')) return true;
  return false;
}

const TEST_CMD_RE =
  /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w-]+)?\b|(?:vitest|jest|mocha|ava|pytest|unittest|rspec|phpunit)\b|(?:go|cargo|dotnet|mvn|gradle)\s+test\b|ctest\b|node\s+--test\b)/i;
const BUILD_CMD_RE =
  /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|typecheck|check|lint)(?::[\w-]+)?\b|tsc\b|vite\s+build\b|webpack\b|esbuild\b|rollup\b|cargo\s+(?:build|check|clippy)\b|go\s+(?:build|vet)\b|mvn\s+(?:compile|package|verify)\b|gradle\s+(?:build|check)\b|dotnet\s+build\b|(?:make|cmake|eslint|ruff|mypy|pyright|flake8)\b|prettier\s+--check\b|agy\s+plugin\s+validate\b)/i;
const SEARCH_CMD_RE = /^(?:rg|ripgrep|grep|egrep|fgrep|findstr|select-string|ag|ack|fd|find)\b/i;
const TRIVIAL_CMD_RE =
  /^(?:pwd|whoami|date|git\s+(?:status|branch|rev-parse|remote)(?:\s+-[a-z-]+)*|node\s+(?:-v|--version)|python\s+--version)$/i;

function splitShellSegments(commandLine) {
  const segments = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < commandLine.length; i++) {
    const ch = commandLine[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < commandLine.length) {
        cur += ch + commandLine[++i];
        continue;
      }
      if (ch === quote) quote = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '\r' || ch === '|') {
      if (ch === '|' && commandLine[i + 1] === '|') i++;
      if (cur.trim()) segments.push(cur.trim());
      cur = '';
      continue;
    }
    if (ch === '&' && commandLine[i + 1] === '&') {
      i++;
      if (cur.trim()) segments.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) segments.push(cur.trim());
  return segments;
}

function stripCommandPrefixes(segment) {
  let s = segment.trim();
  let changed = true;
  while (changed) {
    changed = false;
    const envMatch = s.match(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+/);
    if (envMatch) {
      s = s.slice(envMatch[0].length).trimStart();
      changed = true;
      continue;
    }
    const wrapMatch = s.match(
      /^(?:env|nohup|nice|npx|bunx|uv\s+run|poetry\s+run|timeout\s+\S+|cmd\s+\/c)\s+/i
    );
    if (wrapMatch) {
      s = s.slice(wrapMatch[0].length).trimStart();
      changed = true;
    }
  }
  return s;
}

function classifyShellCommand(commandLine) {
  const cmd = String(commandLine || '').trim();
  if (!cmd) return 'trivial';
  const segments = splitShellSegments(cmd);
  if (segments.length === 0) return 'trivial';

  let sawBuild = false;
  let sawSearch = false;
  let allTrivial = true;

  for (const rawSeg of segments) {
    const seg = stripCommandPrefixes(rawSeg);
    if (!seg || TRIVIAL_CMD_RE.test(seg)) continue;
    allTrivial = false;
    if (TEST_CMD_RE.test(seg)) return 'test';
    if (BUILD_CMD_RE.test(seg)) sawBuild = true;
    else if (SEARCH_CMD_RE.test(seg)) sawSearch = true;
  }

  if (sawBuild) return 'build';
  if (sawSearch) return 'search';
  return allTrivial ? 'trivial' : 'other';
}

function buildCallSignature(toolName, args = {}) {
  const keyObj = {
    toolName,
    path: normalizePath(extractTargetPath(args)),
    cmd: typeof args.CommandLine === 'string' ? args.CommandLine.trim() : '',
    query: typeof args.Query === 'string' ? args.Query.trim() : '',
    pattern: typeof args.Pattern === 'string' ? args.Pattern.trim() : '',
  };
  return crypto.createHash('sha1').update(JSON.stringify(keyObj)).digest('hex').slice(0, 12);
}

module.exports = {
  readStdinJson,
  getStateDir,
  getMode,
  loadState,
  saveState,
  normalizePath,
  isSubagent,
  isExemptRead,
  isExemptWrite,
  classifyShellCommand,
  buildCallSignature,
  emitJson,
};
