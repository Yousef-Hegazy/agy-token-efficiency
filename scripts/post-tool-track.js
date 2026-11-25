#!/usr/bin/env node
'use strict';

const {
  readStdinJson,
  getStateDir,
  loadState,
  saveState,
  isSubagent,
  isExemptRead,
  isExemptWrite,
  classifyShellCommand,
  emitJson,
} = require('./hook-utils');

function collectInvokedTypes(args = {}) {
  const types = [];
  if (typeof args.TypeName === 'string' && args.TypeName) types.push(args.TypeName);
  if (Array.isArray(args.Subagents)) {
    for (const s of args.Subagents) {
      if (s && typeof s.TypeName === 'string' && s.TypeName) types.push(s.TypeName);
    }
  }
  return types;
}

async function main() {
  const payload = await readStdinJson(500);
  const convId = payload.conversationId;
  const stateDir = getStateDir();
  const state = loadState(convId, stateDir);

  if (isSubagent(payload, state)) {
    state.isSubagent = true;
    saveState(convId, state, stateDir);
    return emitJson({});
  }

  if (typeof payload.stepIdx === 'number') {
    state.lastStepIdx = Math.max(state.lastStepIdx, payload.stepIdx);
  }

  const toolCall = payload.toolCall || {};
  const toolName = toolCall.name || '';
  const args = toolCall.args || {};

  if (toolName === 'invoke_subagent') {
    const types = collectInvokedTypes(args);
    state.delegatedCalls += Math.max(1, types.length);
    for (const t of types) {
      if (t === 'fast-editor' || t === 'self') state.unverifiedEdits = true;
      if (t === 'builder') state.buildChecked = true;
      if (t === 'verifier') state.unverifiedEdits = false;
    }
    saveState(convId, state, stateDir);
    return emitJson({});
  }

  if (
    toolName === 'edit_file' ||
    toolName === 'replace_file_content' ||
    toolName === 'multi_replace_file_content' ||
    toolName === 'write_file' ||
    toolName === 'write_to_file'
  ) {
    if (!isExemptWrite(args, payload)) {
      state.unverifiedEdits = true;
      state.directBloatCount += 1;
      state.pendingDriftNudge =
        "Direct workspace edit detected in Brain context. Use 'fast-editor' (flash_lite) for code edits and 'verifier' before finishing.";
    }
  } else if (toolName === 'run_command') {
    const kind = classifyShellCommand(args.CommandLine || '');
    if (kind === 'build') {
      state.buildChecked = true;
      state.directBloatCount += 1;
      state.pendingDriftNudge =
        "Direct build/lint command ran in Brain context. Delegate builds/typechecks/linters to 'builder' (flash_lite) to keep raw logs out of Brain history.";
    } else if (kind === 'test') {
      state.unverifiedEdits = false;
      state.directBloatCount += 1;
      state.pendingDriftNudge =
        "Direct test command ran in Brain context. Delegate test suites and verification to 'verifier' (flash_lite) to keep test output out of Brain history.";
    } else if (kind === 'search') {
      state.directBloatCount += 1;
      state.pendingDriftNudge =
        "Direct search command ran in Brain context. Delegate code searches to 'code-searcher' (flash_lite) and request exact file:line citations.";
    }
  } else if (toolName === 'read_file' || toolName === 'view_file') {
    if (!isExemptRead(args, payload)) {
      state.directBloatCount += 1;
      state.pendingDriftNudge =
        "Unbounded file read ran in Brain context. Delegate file reading/inspection to 'code-searcher' (flash_lite) with DETAIL_LEVEL=exact_lines or exact_snippets.";
    }
  }

  saveState(convId, state, stateDir);
  return emitJson({});
}

main().catch(() => emitJson({}));
