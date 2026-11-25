#!/usr/bin/env node
'use strict';

const {
  readStdinJson,
  getStateDir,
  getMode,
  loadState,
  saveState,
  isSubagent,
  isExemptRead,
  isExemptWrite,
  classifyShellCommand,
  buildCallSignature,
  emitJson,
} = require('./hook-utils');

function classifyDirectViolation(toolName, args, payload) {
  if (toolName === 'run_command') {
    const cmd = args.CommandLine || '';
    const kind = classifyShellCommand(cmd);
    if (kind === 'test') {
      return {
        limb: 'verifier',
        why: 'Direct test command floods Brain context with raw test logs.',
      };
    }
    if (kind === 'build') {
      return {
        limb: 'builder',
        why: 'Direct build/lint/typecheck floods Brain context with compiler output.',
      };
    }
    if (kind === 'search') {
      return {
        limb: 'code-searcher',
        why: 'Direct recursive search floods Brain context with match lines.',
      };
    }
    return null;
  }

  if (toolName === 'grep_search' || toolName === 'find_by_name') {
    return {
      limb: 'code-searcher',
      why: 'Repository search belongs in code-searcher.',
    };
  }

  if (toolName === 'read_file' || toolName === 'view_file') {
    if (isExemptRead(args, payload)) return null;
    return {
      limb: 'code-searcher',
      why: 'Unbounded or large file reads bloat Brain context.',
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
    return {
      limb: 'fast-editor',
      why: 'Workspace code edits belong in fast-editor.',
    };
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

  const userInput = typeof payload.lastUserInput === 'string' ? payload.lastUserInput : '';
  if (userInput && state.lastUserInput && state.lastUserInput !== userInput) {
    state.warnedSignatures = {};
    state.stopWarnedAtStep = null;
  }
  if (userInput) state.lastUserInput = userInput;

  const toolCall = payload.toolCall || {};
  const toolName = toolCall.name || '';
  const args = toolCall.args || {};

  const violation = classifyDirectViolation(toolName, args, payload);
  if (!violation) return emitJson({ decision: 'allow' });

  const sig = buildCallSignature(toolName, args);
  if (mode === 'soft-gate' && state.warnedSignatures[sig]) {
    saveState(convId, state, stateDir);
    return emitJson({ decision: 'allow' });
  }

  state.warnedSignatures[sig] = true;
  saveState(convId, state, stateDir);

  const retryHint =
    mode === 'soft-gate'
      ? ' (If a direct call is strictly required, repeating this exact call will be permitted.)'
      : '';

  return emitJson({
    decision: 'deny',
    reason: `[Brain & Limbs] ${violation.why} Delegate to '${violation.limb}' via invoke_subagent (Model: 'flash_lite') requesting exact file:line locations.${retryHint}`,
  });
}

main().catch(() => emitJson({ decision: 'allow' }));
