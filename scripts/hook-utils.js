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
      const buf = Buffer.alloc(4096);
      const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
      const firstLine = buf.toString('utf8', 0, bytes).split(/\r?\n/)[0];
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

  const start = Number(args.StartLine);
  const end = Number(args.EndLine);
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start + 1 <= 80) {
    return true;
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
  /\b(npm\s+test|pnpm\s+test|yarn\s+test|bun\s+test|vitest|jest|mocha|ava|pytest|unittest|go\s+test|cargo\s+test|ctest|dotnet\s+test|mvn\s+test|gradle\s+test|rspec|phpunit|node\s+--test)\b/i;
const BUILD_CMD_RE =
  /\b(npm\s+run\s+(build|typecheck|check|lint)|pnpm\s+(build|typecheck|lint)|yarn\s+(build|typecheck|lint)|tsc\b|vite\s+build|webpack|esbuild|rollup|cargo\s+(build|check|clippy)|go\s+(build|vet)|mvn\s+(compile|package|verify)|gradle\s+(build|check)|dotnet\s+build|make\b|cmake\b|eslint\b|ruff\b|mypy\b|pyright\b|flake8\b|prettier\s+--check|agy\s+plugin\s+validate)\b/i;
const SEARCH_CMD_RE =
  /(?:^|[;&|]\s*)(rg|ripgrep|grep|egrep|fgrep|findstr|select-string|ag|ack|fd|find)\b/i;
const TRIVIAL_CMD_RE =
  /^\s*(pwd|whoami|date|git\s+(status|branch|rev-parse|remote)(\s+-[a-z-]+)*|node\s+(-v|--version)|python\s+--version)\s*$/i;

function classifyShellCommand(commandLine) {
  const cmd = String(commandLine || '').trim();
  if (!cmd) return 'trivial';
  if (TRIVIAL_CMD_RE.test(cmd)) return 'trivial';
  if (TEST_CMD_RE.test(cmd)) return 'test';
  if (BUILD_CMD_RE.test(cmd)) return 'build';
  if (SEARCH_CMD_RE.test(cmd)) return 'search';
  return 'other';
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
