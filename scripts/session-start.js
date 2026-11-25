#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const {
  readStdinJson,
  getStateDir,
  loadState,
  saveState,
  isSubagent,
  detectShellEnvironment,
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

  const envInfo = detectShellEnvironment();

  return emitJson({
    injectSteps: [
      {
        systemMessage: {
          systemMessage:
            '[Brain & Limbs Protocol Active — 3-Tier Total-Cost Balanced]\n' +
            'Optimize Total Cost = (Brain_Turns x Avg_Context) + Limb_Cold_Starts (target <=10-15 Limbs/task).\n' +
            '- Brain (top-tier): planning, hard debugging, bounded reads <=300 lines (or small files <=250 lines / 10 KB), and <50-line surgical edits in context.\n' +
            "- Mid-tier (Model: 'flash'): 'implementer' for complex/type-heavy logic & large/multi-file edits (+ targeted self-verify).\n" +
            "- Lite-tier (Model: 'flash_lite'): 'code-searcher' (1 comprehensive batch + verbatim signatures/imports), 'fast-editor' (strictly mechanical/boilerplate), 'verifier' (all builds/lints/tests/diff checks).\n" +
            '- Zero-Polling Rule: NEVER use schedule/sleep timers to poll subagents—end turn and wait for automatic wakeup.\n' +
            `- ${envInfo.shellHint}\n` +
            `- ${envInfo.testHint}`,
        },
      },
    ],
  });
}

main().catch(() => emitJson({}));
