#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const {
  readStdinJson,
  getStateDir,
  loadState,
  saveState,
  isSubagent,
  emitJson,
} = require('./hook-utils');

async function main() {
  const payload = await readStdinJson(500);
  const convId = payload.conversationId;
  const stateDir = getStateDir();
  const state = loadState(convId, stateDir);
  const sub = isSubagent(payload, state);
  const hasTranscript = Boolean(payload.transcriptPath && fs.existsSync(payload.transcriptPath));

  if (sub) {
    state.isSubagent = true;
    saveState(convId, state, stateDir);
    return emitJson({});
  }

  if (!hasTranscript && !payload.lastUserInput) {
    saveState(convId, state, stateDir);
    return emitJson({});
  }

  state.isSubagent = false;
  saveState(convId, state, stateDir);

  return emitJson({
    injectSteps: [
      {
        systemMessage: {
          systemMessage:
            '[Brain & Limbs Protocol Active]\n' +
            'Act strictly as the orchestrator (Brain). Delegate execution to pre-registered flash_lite Limbs via invoke_subagent:\n' +
            "- 'code-searcher': File discovery, symbol grep, multi-line/full-file reads.\n" +
            "- 'fast-editor': Targeted code edits, refactors, docstrings, file writes.\n" +
            "- 'builder': Builds, compiles, typechecks, linters (returns exact file:line error digests).\n" +
            "- 'verifier': Test suites, diff/requirement checks, anti-cheat assertion verification.\n" +
            'Send crisp TARGET/TASK/DETAIL_LEVEL signals; request exact_lines/exact_snippets when needed. Escalate to flash only after repeated failure.',
        },
      },
    ],
  });
}

main().catch(() => emitJson({}));
