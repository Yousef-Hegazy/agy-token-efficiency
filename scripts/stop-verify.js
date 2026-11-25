#!/usr/bin/env node
'use strict';

const {
  readStdinJson,
  getStateDir,
  loadState,
  saveState,
  isSubagent,
  emitJson,
} = require('./hook-utils');

const NORMAL_STOPS = new Set(['', 'NO_TOOL_CALL', 'model_stop']);

async function main() {
  const payload = await readStdinJson(500);
  if (payload.continuationActive === true) return emitJson({});

  const reason = typeof payload.terminationReason === 'string' ? payload.terminationReason : '';
  if (!NORMAL_STOPS.has(reason)) return emitJson({});

  const convId = payload.conversationId;
  const stateDir = getStateDir();
  const state = loadState(convId, stateDir);

  if (isSubagent(payload, state) || !state.unverifiedEdits) {
    return emitJson({});
  }

  if (state.stopWarnedAtStep !== null && state.stopWarnedAtStep === state.lastStepIdx) {
    return emitJson({});
  }

  state.stopWarnedAtStep = state.lastStepIdx;
  saveState(convId, state, stateDir);

  return emitJson({
    decision: 'continue',
    reason:
      "[Brain & Limbs] Workspace files were modified without a delegated 'verifier' pass. Invoke 'verifier' (Model: 'flash_lite') with the changed files and verification target, then report its STATUS/LOCATIONS before concluding.",
  });
}

main().catch(() => emitJson({}));
