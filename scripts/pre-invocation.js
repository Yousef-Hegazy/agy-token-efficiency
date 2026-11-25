#!/usr/bin/env node
'use strict';

const {
  readStdinJson,
  getStateDir,
  loadState,
  saveState,
  syncTurnState,
  isSubagent,
  emitJson,
} = require('./hook-utils');

async function main() {
  const payload = await readStdinJson(500);
  const convId = payload.conversationId;
  const stateDir = getStateDir();
  const state = loadState(convId, stateDir);

  if (isSubagent(payload, state)) {
    return emitJson({});
  }

  syncTurnState(state, payload.lastUserInput);

  if (!state.pendingDriftNudge) {
    saveState(convId, state, stateDir);
    return emitJson({});
  }

  const nudge = state.pendingDriftNudge;
  state.pendingDriftNudge = null;
  saveState(convId, state, stateDir);

  return emitJson({
    injectSteps: [
      {
        systemMessage: {
          systemMessage: `[Brain & Limbs Drift Notice] ${nudge}`,
        },
      },
    ],
  });
}

main().catch(() => emitJson({}));
