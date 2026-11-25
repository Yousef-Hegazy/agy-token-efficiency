#!/usr/bin/env node
'use strict';

const {
  readStdinJson,
  getStateDir,
  loadState,
  saveState,
  isSubagent,
  inspectTranscriptVerification,
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

  if (
    state.lastVerifiedStep !== null &&
    state.lastMutationStep !== null &&
    state.lastVerifiedStep > state.lastMutationStep
  ) {
    state.unverifiedEdits = false;
    saveState(convId, state, stateDir);
    return emitJson({});
  }

  const transcriptCheck = inspectTranscriptVerification(
    payload.transcriptPath,
    state.lastMutationStep
  );
  if (transcriptCheck.verified) {
    state.unverifiedEdits = false;
    state.lastVerifiedStep = transcriptCheck.step;
    state.lastVerificationSource = 'transcript';
    saveState(convId, state, stateDir);
    return emitJson({});
  }

  if (state.stopWarnedAtStep !== null && state.stopWarnedAtStep === state.lastStepIdx) {
    return emitJson({});
  }
  if (state.lastUserInput && state.stopWarnedUserInput === state.lastUserInput) {
    return emitJson({});
  }

  state.stopWarnedAtStep = state.lastStepIdx;
  state.stopWarnedUserInput = state.lastUserInput || null;
  saveState(convId, state, stateDir);

  return emitJson({
    decision: 'continue',
    reason:
      "[Brain & Limbs] Source files were modified without a passing verification check. Run 'verifier' (Model: 'flash_lite') or a targeted single-run test check before concluding.",
  });
}

main().catch(() => emitJson({}));
