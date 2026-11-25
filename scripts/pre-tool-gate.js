#!/usr/bin/env node
'use strict';

const {
  readStdinJson,
  getStateDir,
  getMode,
  loadState,
  saveState,
  syncTurnState,
  isSubagent,
  inspectReadRequest,
  isExemptWrite,
  estimateEditLines,
  classifyShellCommand,
  isTargetedShellCheck,
  isScopedShellSearch,
  isPollingSchedule,
  buildCallSignature,
  emitJson,
} = require('./hook-utils');

function classifyDirectViolation(toolName, args, payload, mode, state) {
  if (toolName === 'schedule') {
    const poll = isPollingSchedule(args, state);
    if (poll.isPolling) {
      return {
        limb: 'reactive-wakeup',
        persistent: true,
        isPolling: true,
        why: `Zero-Polling Rule: ${poll.reason}. End your turn without timers—Antigravity wakes Brain automatically when subagents finish.`,
      };
    }
    return null;
  }

  if (toolName === 'run_command') {
    const cmd = args.CommandLine || '';
    const kind = classifyShellCommand(cmd);
    if (kind === 'polling') {
      return {
        limb: 'reactive-wakeup',
        persistent: true,
        isPolling: true,
        why: 'Zero-Polling Rule: Shell sleep/timeout polling wastes turns. End your turn and wait passively for subagent completion.',
      };
    }
    if (kind === 'test') {
      if (mode === 'soft-gate' && isTargetedShellCheck(cmd)) return null;
      return {
        limb: 'verifier',
        model: 'flash_lite',
        why: 'Broad test suites flood Brain context with raw test logs.',
      };
    }
    if (kind === 'build') {
      if (mode === 'soft-gate' && isTargetedShellCheck(cmd)) return null;
      return {
        limb: 'verifier',
        model: 'flash_lite',
        why: 'Broad build/lint/typecheck commands flood Brain context with compiler output.',
      };
    }
    if (kind === 'search') {
      if (mode === 'soft-gate' && isScopedShellSearch(cmd)) return null;
      return {
        limb: 'code-searcher',
        model: 'flash_lite',
        why: 'Direct recursive shell search floods Brain context with match lines.',
      };
    }
    return null;
  }

  if (toolName === 'grep_search' || toolName === 'find_by_name') {
    if (mode === 'strict') {
      return {
        limb: 'code-searcher',
        model: 'flash_lite',
        why: 'Repository search belongs in code-searcher.',
      };
    }
    // Avoid turn-wasting hard rejections on quick IDE searches in soft-gate.
    return null;
  }

  if (toolName === 'read_file' || toolName === 'view_file') {
    const readCheck = inspectReadRequest(args, payload);
    if (readCheck.exempt) return null;
    return {
      limb: 'code-searcher',
      model: 'flash_lite',
      why: readCheck.reason,
    };
  }

  if (
    toolName === 'edit_file' ||
    toolName === 'replace_file_content' ||
    toolName === 'multi_replace_file_content' ||
    toolName === 'write_file' ||
    toolName === 'write_to_file'
  ) {
    if (isExemptWrite(args, payload)) return null;
    if (mode === 'strict') {
      const lines = estimateEditLines(toolName, args);
      const useMidTier = lines > 30 || toolName === 'multi_replace_file_content';
      return {
        limb: useMidTier ? 'implementer' : 'fast-editor',
        model: useMidTier ? 'flash' : 'flash_lite',
        why: useMidTier
          ? 'Large or multi-hunk workspace code edits belong in implementer.'
          : 'Mechanical workspace code edits belong in fast-editor.',
      };
    }
    // In soft-gate, Brain edits surgical/hard debugging fixes directly without a retry rejection.
    return null;
  }

  return null;
}

async function main() {
  const payload = await readStdinJson(500);
  const stateDir = getStateDir();
  const mode = getMode(stateDir);
  if (mode === 'advisory') return emitJson({ decision: 'allow' });

  const convId = payload.conversationId;
  const state = loadState(convId, stateDir);
  if (isSubagent(payload, state)) {
    state.isSubagent = true;
    saveState(convId, state, stateDir);
    return emitJson({ decision: 'allow' });
  }

  syncTurnState(state, payload.lastUserInput);

  const toolCall = payload.toolCall || {};
  const toolName = toolCall.name || '';
  const args = toolCall.args || {};

  const violation = classifyDirectViolation(toolName, args, payload, mode, state);
  if (!violation) {
    saveState(convId, state, stateDir);
    return emitJson({ decision: 'allow' });
  }

  if (violation.isPolling) {
    state.pollingAttempts += 1;
    state.directBloatCount += 1;
    saveState(convId, state, stateDir);
    return emitJson({
      decision: 'deny',
      reason: `[Brain & Limbs] ${violation.why}`,
    });
  }

  const sig = buildCallSignature(toolName, args);
  if (mode === 'soft-gate' && !violation.persistent && state.warnedSignatures[sig]) {
    saveState(convId, state, stateDir);
    return emitJson({ decision: 'allow' });
  }

  state.warnedSignatures[sig] = true;
  saveState(convId, state, stateDir);

  const retryHint =
    mode === 'soft-gate'
      ? ' (If strictly required, repeating this exact call will be permitted.)'
      : '';
  const modelId = violation.model || 'flash_lite';

  return emitJson({
    decision: 'deny',
    reason: `[Brain & Limbs] ${violation.why} Or delegate to '${violation.limb}' via invoke_subagent (Model: '${modelId}').${retryHint}`,
  });
}

main().catch(() => emitJson({ decision: 'allow' }));
