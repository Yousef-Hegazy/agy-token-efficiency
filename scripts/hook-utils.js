'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const VALID_MODES = new Set(['advisory', 'soft-gate', 'strict']);

const MAX_BOUNDED_READ_LINES = 300;
const MAX_SMALL_FILE_LINES = 250;
const MAX_SMALL_FILE_BYTES = 10 * 1024;
const MAX_BOUNDED_SLICE_BYTES = 24 * 1024;
const MAX_DIRECT_MICRO_READ_LINES = 150;
const MAX_MICRO_READS_PER_FILE = 3;
const MAX_FAST_EDITOR_RETRIES_PER_FILE = 2;
const MAX_IMPLEMENTER_RETRIES_PER_FILE = 2;
const COARSE_LIMB_BUDGET = 15;

const NON_SOURCE_EXT_RE =
  /\.(?:md|mdx|txt|rst|adoc|log|csv|tsv|svg|png|jpe?g|gif|webp|ico|pdf|lock)$/i;
const NON_SOURCE_NAME_RE =
  /^(?:readme|license|copying|changelog|changes|authors|contributors|notice)(?:\.[^./\\]+)?$/i;

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
    turnDelegatedCalls: 0,
    delegationMilestoneWarned: 0,
    pollingAttempts: 0,
    directSearchCount: 0,
    largeWriteCount: 0,
    lastMutationStep: null,
    lastVerifiedStep: null,
    lastVerificationSource: null,
    sameFileReadCounts: {},
    sameFileMicroReadWarned: {},
    fastEditorFileCounts: {},
    fastEditorWarned: {},
    implementerFileCounts: {},
    implementerWarned: {},
    pendingDriftNudge: null,
    warnedSignatures: {},
    stopWarnedAtStep: null,
    stopWarnedUserInput: null,
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

function syncTurnState(state, userInput) {
  const clean = typeof userInput === 'string' ? userInput : '';
  if (clean && state.lastUserInput && state.lastUserInput !== clean) {
    state.warnedSignatures = {};
    state.stopWarnedAtStep = null;
    state.stopWarnedUserInput = null;
    state.turnDelegatedCalls = 0;
    state.delegationMilestoneWarned = 0;
    state.pollingAttempts = 0;
    state.directSearchCount = 0;
    state.largeWriteCount = 0;
    state.sameFileReadCounts = {};
    state.sameFileMicroReadWarned = {};
    state.fastEditorFileCounts = {};
    state.fastEditorWarned = {};
    state.implementerFileCounts = {};
    state.implementerWarned = {};
    state.pendingDriftNudge = null;
  }
  if (clean) state.lastUserInput = clean;
}

function appendNudge(state, msg) {
  if (!msg) return;
  if (!state.pendingDriftNudge) {
    state.pendingDriftNudge = msg;
    return;
  }
  if (state.pendingDriftNudge.includes(msg)) return;
  const parts = state.pendingDriftNudge.split(' | ');
  if (parts.length >= 2) return;
  state.pendingDriftNudge = `${state.pendingDriftNudge} | ${msg}`;
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

function isMetaOrSkillPath(normFile, payload = {}) {
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
  return isUnderDir(normFile, artifactDir);
}

function countLinesFast(text) {
  if (!text) return 0;
  return text.replace(/\r?\n$/, '').split(/\r?\n/).length;
}

function inspectDiskFileStats(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return null;
  try {
    if (!fs.existsSync(rawPath)) return null;
    const stat = fs.statSync(rawPath);
    if (!stat.isFile()) return null;
    const sizeBytes = stat.size;
    let totalLines = null;
    if (sizeBytes <= 2 * 1024 * 1024) {
      const content = fs.readFileSync(rawPath, 'utf8');
      totalLines = countLinesFast(content);
      return { sizeBytes, totalLines, content };
    }
    return { sizeBytes, totalLines: null, content: null };
  } catch {
    return null;
  }
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function inspectReadRequest(args = {}, payload = {}) {
  if (args.IsSkillFile === true) return { exempt: true, meta: true, span: null };
  const rawPath = extractTargetPath(args);
  const normFile = normalizePath(rawPath);
  if (!normFile) {
    return {
      exempt: false,
      span: null,
      reason: 'Missing target file path for read_file.',
    };
  }
  if (isMetaOrSkillPath(normFile, payload)) {
    return { exempt: true, meta: true, span: null };
  }

  const hasStart = args.StartLine != null && args.StartLine !== '';
  const hasEnd = args.EndLine != null && args.EndLine !== '';
  const disk = inspectDiskFileStats(rawPath);
  const label = path.basename(rawPath) || rawPath;

  if (hasStart || hasEnd) {
    if (!hasStart || !hasEnd) {
      return {
        exempt: false,
        span: null,
        invalidBounds: true,
        reason: `Incomplete line range for '${label}'. Provide both StartLine and EndLine (1-based, <= ${MAX_BOUNDED_READ_LINES} lines, e.g. StartLine: 1, EndLine: 250) or use 'code-searcher'.`,
      };
    }
    const start = Number(args.StartLine);
    const end = Number(args.EndLine);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      return {
        exempt: false,
        span: null,
        invalidBounds: true,
        reason: `Invalid line range (${args.StartLine}..${args.EndLine}) for '${label}'. Use StartLine >= 1 and EndLine >= StartLine (<= ${MAX_BOUNDED_READ_LINES} lines).`,
      };
    }
    const span = end - start + 1;
    if (span > MAX_BOUNDED_READ_LINES) {
      const recEnd = start + MAX_BOUNDED_READ_LINES - 1;
      const sizeNote = disk ? ` (${disk.totalLines ?? '?'} lines, ${formatKb(disk.sizeBytes)})` : '';
      return {
        exempt: false,
        span,
        totalLines: disk ? disk.totalLines : null,
        sizeBytes: disk ? disk.sizeBytes : null,
        recommendedStartLine: start,
        recommendedEndLine: recEnd,
        reason: `Requested range (${span} lines) on '${label}'${sizeNote} exceeds the ${MAX_BOUNDED_READ_LINES}-line cap. Narrow to StartLine: ${start}, EndLine: ${recEnd} or delegate to 'code-searcher'.`,
      };
    }

    if (disk && disk.sizeBytes > MAX_BOUNDED_SLICE_BYTES && disk.content != null) {
      const lines = disk.content.replace(/\r?\n$/, '').split(/\r?\n/);
      const sliceText = lines.slice(start - 1, end).join('\n');
      const sliceBytes = Buffer.byteLength(sliceText, 'utf8');
      if (sliceBytes > MAX_BOUNDED_SLICE_BYTES) {
        const recEnd = Math.max(start, start + Math.min(40, Math.floor(span / 4)) - 1);
        return {
          exempt: false,
          span,
          sizeBytes: sliceBytes,
          recommendedStartLine: start,
          recommendedEndLine: recEnd,
          reason: `Requested slice on '${label}' is ${formatKb(sliceBytes)} (minified/wide lines > ${formatKb(MAX_BOUNDED_SLICE_BYTES)}). Narrow to StartLine: ${start}, EndLine: ${recEnd} or delegate to 'code-searcher'.`,
        };
      }
    }

    return {
      exempt: true,
      span,
      totalLines: disk ? disk.totalLines : null,
      sizeBytes: disk ? disk.sizeBytes : null,
    };
  }

  // Unbounded read (no StartLine / EndLine)
  if (disk) {
    if (
      disk.sizeBytes <= MAX_SMALL_FILE_BYTES &&
      disk.totalLines !== null &&
      disk.totalLines <= MAX_SMALL_FILE_LINES
    ) {
      return {
        exempt: true,
        smallFile: true,
        span: disk.totalLines,
        totalLines: disk.totalLines,
        sizeBytes: disk.sizeBytes,
      };
    }
    const lineInfo = disk.totalLines !== null ? `${disk.totalLines} lines, ` : '';
    const recEnd =
      disk.totalLines !== null
        ? Math.min(disk.totalLines, MAX_SMALL_FILE_LINES)
        : MAX_SMALL_FILE_LINES;
    return {
      exempt: false,
      span: null,
      totalLines: disk.totalLines,
      sizeBytes: disk.sizeBytes,
      recommendedStartLine: 1,
      recommendedEndLine: recEnd,
      reason: `Unbounded read on large file '${label}' (${lineInfo}${formatKb(disk.sizeBytes)}) exceeds ${MAX_SMALL_FILE_LINES} lines / ${formatKb(MAX_SMALL_FILE_BYTES)}. Retry with StartLine: 1, EndLine: ${recEnd} (<= ${MAX_BOUNDED_READ_LINES} lines) or delegate to 'code-searcher'.`,
    };
  }

  return {
    exempt: false,
    span: null,
    recommendedStartLine: 1,
    recommendedEndLine: MAX_SMALL_FILE_LINES,
    reason: `Unbounded read on '${label}' (unverified size). Specify bounded StartLine: 1, EndLine: ${MAX_SMALL_FILE_LINES} (<= ${MAX_BOUNDED_READ_LINES} lines) or delegate to 'code-searcher'.`,
  };
}

function isExemptRead(args = {}, payload = {}) {
  return inspectReadRequest(args, payload).exempt;
}

function isExemptWrite(args = {}, payload = {}) {
  const normFile = normalizePath(extractTargetPath(args));
  if (!normFile) return false;
  const artifactDir = normalizePath(payload.artifactDirectoryPath || '');
  if (isUnderDir(normFile, artifactDir)) return true;
  if (normFile.includes('/.gemini/antigravity') && normFile.includes('/brain/')) return true;
  return false;
}

function isSourceFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return true;
  const norm = normalizePath(filePath);
  if (!norm) return true;
  const base = norm.split('/').pop() || '';
  if (NON_SOURCE_NAME_RE.test(base)) return false;
  if (NON_SOURCE_EXT_RE.test(norm)) return false;
  return true;
}

function extractFilePathsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(/(?:[A-Za-z]:[\\/])?(?:[\w.-]+[\\/])*[\w.-]+\.[A-Za-z0-9]{1,10}/g) || [];
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    if (/^\d+(?:\.\d+)+$/.test(m)) continue;
    if (/^(?:e\.g|i\.e|vs|etc)\./i.test(m)) continue;
    const norm = normalizePath(m);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(m);
  }
  return out;
}

function estimateEditLines(toolName, args = {}) {
  if (toolName === 'multi_replace_file_content' && Array.isArray(args.ReplacementChunks)) {
    return args.ReplacementChunks.reduce(
      (sum, chunk) => sum + countLinesFast(String((chunk && chunk.ReplacementContent) || '')),
      0
    );
  }
  const body =
    args.Replacement ?? args.ReplacementContent ?? args.Content ?? args.CodeContent ?? '';
  return countLinesFast(String(body));
}

const POLLING_CMD_RE =
  /^(?:sleep|start-sleep|usleep)\b|^timeout\s+\/t\b|^ping\s+-n\s+\d+\s+(?:127\.0\.0\.1|localhost)\b/i;
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
      /^(?:env|nohup|nice|npx|bunx|uv\s+run|poetry\s+run|timeout\s+(?!\/t\b)\S+|cmd\s+\/c)\s+/i
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
    if (POLLING_CMD_RE.test(seg)) return 'polling';
    if (TEST_CMD_RE.test(seg)) return 'test';
    if (BUILD_CMD_RE.test(seg)) sawBuild = true;
    else if (SEARCH_CMD_RE.test(seg)) sawSearch = true;
  }

  if (sawBuild) return 'build';
  if (sawSearch) return 'search';
  return allTrivial ? 'trivial' : 'other';
}

function isTargetedShellCheck(commandLine) {
  const cmd = String(commandLine || '').trim();
  if (!cmd) return false;
  const segments = splitShellSegments(cmd);
  if (segments.length !== 1) return false;
  const seg = stripCommandPrefixes(segments[0]);
  if (/\b(?:--workspace|--all|--all-targets)\b/i.test(seg)) return false;
  if (/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|check|lint)\b/i.test(seg)) return false;
  if (/^(?:tsc|cargo\s+build)\b/i.test(seg)) return false;
  const hasSingleFileArg =
    /\s(?:["']?[\w./\\-]+\.(?:[jt]sx?|mjs|cjs|py|rs|go)["']?)(?:\s|$)/i.test(seg) &&
    !/\*/.test(seg);
  if (
    hasSingleFileArg &&
    /^(?:vitest\s+run|jest|node\s+--test|pytest|eslint|ruff|prettier\s+--check)\b/i.test(seg)
  ) {
    return true;
  }
  return false;
}

function isScopedShellSearch(commandLine) {
  const cmd = String(commandLine || '').trim();
  if (!cmd) return false;
  return (
    /\|\s*(?:head|select-object\s+-first)\b/i.test(cmd) ||
    /\s(?:-l|--files-with-matches|--count|-c|-m\s*\d+|--max-count(?:=|\s+)\d+)\b/.test(cmd)
  );
}

const POLL_PROMPT_RE =
  /\b(?:subagent|limb|agent|worker|code-searcher|fast-editor|implementer|verifier|background|poll(?:ing)?|check\s+(?:progress|if|whether|status|task)|wait(?:ing)?\s+(?:for|on)|finish(?:ed)?|complet(?:e|ed)|wake\s*up)\b/i;

function isPollingSchedule(args = {}, state = {}) {
  const cron = typeof args.CronExpression === 'string' ? args.CronExpression.trim() : '';
  if (cron || args.IsDaemon === true) {
    return { isPolling: false };
  }
  const timerCond = typeof args.TimerCondition === 'string' ? args.TimerCondition.trim() : '';
  if (timerCond && timerCond.toLowerCase() !== 'never') {
    return {
      isPolling: true,
      reason: `TimerCondition='${timerCond}' targets background wakeup`,
    };
  }
  const prompt = String(args.Prompt || '');
  if (POLL_PROMPT_RE.test(prompt)) {
    return {
      isPolling: true,
      reason: 'schedule timer prompt checks/waits on subagents or background tasks',
    };
  }
  if (args.DurationSeconds != null && (state.turnDelegatedCalls > 0 || state.pollingAttempts > 0)) {
    return {
      isPolling: true,
      reason: 'one-shot schedule timer called while subagents were dispatched in this turn',
    };
  }
  return { isPolling: false };
}

function detectShellEnvironment(envOverride, platformOverride) {
  const platform = platformOverride || process.platform;
  const env = envOverride || process.env;
  const shellEnv = String(env.SHELL || env.AGY_SHELL || '').trim();
  const psChannel = String(env.POWERSHELL_DISTRIBUTION_CHANNEL || '').trim();

  const shellName = shellEnv ? path.posix.basename(shellEnv.replace(/\\/g, '/')) : '';
  let dialect = shellName ? shellName.replace(/\.exe$/i, '').toLowerCase() : 'posix';
  let supportsAndAnd = true;
  let shellLabel = shellName || 'sh/bash';

  if (platform === 'win32') {
    if (/(?:^|[\\/])(?:bash|zsh|sh|fish)(?:\.exe)?$/i.test(shellEnv)) {
      dialect = shellName.replace(/\.exe$/i, '').toLowerCase();
      supportsAndAnd = true;
      shellLabel = shellName;
    } else if (psChannel || /(?:^|[\\/])pwsh(?:\.exe)?$/i.test(shellEnv)) {
      dialect = 'pwsh';
      supportsAndAnd = true;
      shellLabel = 'pwsh (PowerShell 7+)';
    } else {
      dialect = 'windows-powershell-5.1';
      supportsAndAnd = false;
      shellLabel = 'Windows PowerShell 5.1';
    }
  }

  const shellHint = !supportsAndAnd
    ? `[Env] OS=${platform} | Shell=${shellLabel}: NEVER use '&&' (syntax error in PS 5.1). Chain with '; if ($LASTEXITCODE -eq 0) { ... }' or separate commands.`
    : `[Env] OS=${platform} | Shell=${shellLabel}: '&&' supported.`;

  const testHint =
    "Tests: always pass non-interactive single-run flags ('vitest run', 'cargo test -- --nocapture', 'pytest -q'); never watch mode or background test daemons.";

  return {
    platform,
    dialect,
    supportsAndAnd,
    shellLabel,
    shellHint,
    testHint,
  };
}

function textHasPassingVerification(text) {
  if (!text || typeof text !== 'string') return false;
  if (/STATUS:\s*FAIL\b/i.test(text)) return false;
  if (/VERIFICATION:\s*PASS\b/i.test(text) && /STATUS:\s*OK\b/i.test(text)) return true;
  if (/STATUS:\s*OK\b/i.test(text) && /COUNTS:\s*passed=[1-9]\d*\s+failed=0\b/i.test(text)) {
    return true;
  }
  return false;
}

function responseHasPassingVerification(payload = {}) {
  if (payload.error) return false;
  const raw = payload.toolResponse ?? payload.output ?? payload.result ?? payload.response ?? null;
  if (!raw) return false;
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return textHasPassingVerification(text);
}

function inspectTranscriptVerification(transcriptPath, lastMutationStep = null) {
  if (!transcriptPath || typeof transcriptPath !== 'string') return { verified: false };
  try {
    if (!fs.existsSync(transcriptPath)) return { verified: false };
    const stat = fs.statSync(transcriptPath);
    const maxTail = 256 * 1024;
    let raw = '';
    if (stat.size <= maxTail) {
      raw = fs.readFileSync(transcriptPath, 'utf8');
    } else {
      const fd = fs.openSync(transcriptPath, 'r');
      try {
        const start = stat.size - maxTail;
        const buf = Buffer.alloc(maxTail);
        fs.readSync(fd, buf, 0, maxTail, start);
        raw = buf.toString('utf8');
        const firstNl = raw.indexOf('\n');
        if (firstNl !== -1) raw = raw.slice(firstNl + 1);
      } finally {
        fs.closeSync(fd);
      }
    }

    const lines = raw.split(/\r?\n/).filter(Boolean);
    let latestPassStep = -1;
    let latestMutStep = typeof lastMutationStep === 'number' ? lastMutationStep : -1;

    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      const step = typeof entry.step_index === 'number' ? entry.step_index : -1;

      if (entry.type === 'PLANNER_RESPONSE' && Array.isArray(entry.tool_calls)) {
        for (const tc of entry.tool_calls) {
          if (!tc || !tc.name) continue;
          if (
            tc.name === 'edit_file' ||
            tc.name === 'replace_file_content' ||
            tc.name === 'multi_replace_file_content' ||
            tc.name === 'write_file' ||
            tc.name === 'write_to_file'
          ) {
            const p = extractTargetPath(tc.args || {});
            if (isSourceFile(p) && !isMetaOrSkillPath(normalizePath(p), {})) {
              latestMutStep = Math.max(latestMutStep, step);
            }
          } else if (tc.name === 'invoke_subagent') {
            const tn = tc.args && tc.args.TypeName;
            if (tn === 'fast-editor' || tn === 'implementer' || tn === 'self') {
              const paths = extractFilePathsFromText(
                String((tc.args && (tc.args.Prompt || tc.args.Task || '')) || '')
              );
              if (paths.length === 0 || paths.some((p) => isSourceFile(p))) {
                latestMutStep = Math.max(latestMutStep, step);
              }
            }
          }
        }
        continue;
      }

      if (entry.type === 'USER_INPUT' || entry.status === 'ERROR' || entry.error) continue;
      if (typeof entry.content === 'string' && textHasPassingVerification(entry.content)) {
        latestPassStep = Math.max(latestPassStep, step);
      }
    }

    if (latestPassStep >= 0 && latestPassStep >= latestMutStep) {
      return { verified: true, step: latestPassStep };
    }
    return { verified: false };
  } catch {
    return { verified: false };
  }
}

function buildCallSignature(toolName, args = {}) {
  const keyObj = {
    toolName,
    path: normalizePath(extractTargetPath(args)),
    cmd: typeof args.CommandLine === 'string' ? args.CommandLine.trim() : '',
    query: typeof args.Query === 'string' ? args.Query.trim() : '',
    pattern: typeof args.Pattern === 'string' ? args.Pattern.trim() : '',
    startLine: args.StartLine ?? null,
    endLine: args.EndLine ?? null,
  };
  return crypto.createHash('sha1').update(JSON.stringify(keyObj)).digest('hex').slice(0, 12);
}

module.exports = {
  MAX_BOUNDED_READ_LINES,
  MAX_SMALL_FILE_LINES,
  MAX_SMALL_FILE_BYTES,
  MAX_BOUNDED_SLICE_BYTES,
  MAX_DIRECT_MICRO_READ_LINES,
  MAX_MICRO_READS_PER_FILE,
  MAX_FAST_EDITOR_RETRIES_PER_FILE,
  MAX_IMPLEMENTER_RETRIES_PER_FILE,
  COARSE_LIMB_BUDGET,
  readStdinJson,
  getStateDir,
  getMode,
  loadState,
  saveState,
  syncTurnState,
  appendNudge,
  normalizePath,
  isSubagent,
  extractTargetPath,
  isMetaOrSkillPath,
  inspectReadRequest,
  isExemptRead,
  isExemptWrite,
  isSourceFile,
  extractFilePathsFromText,
  estimateEditLines,
  classifyShellCommand,
  isTargetedShellCheck,
  isScopedShellSearch,
  isPollingSchedule,
  detectShellEnvironment,
  responseHasPassingVerification,
  inspectTranscriptVerification,
  buildCallSignature,
  emitJson,
};
