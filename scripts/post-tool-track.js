#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  readStdinJson,
  getStateDir,
  loadState,
  saveState,
  syncTurnState,
  appendNudge,
  normalizePath,
  isSubagent,
  extractTargetPath,
  isMetaOrSkillPath,
  inspectReadRequest,
  isExemptWrite,
  isSourceFile,
  extractFilePathsFromText,
  estimateEditLines,
  classifyShellCommand,
  isTargetedShellCheck,
  isPollingSchedule,
  responseHasPassingVerification,
  MAX_DIRECT_MICRO_READ_LINES,
  MAX_MICRO_READS_PER_FILE,
  MAX_FAST_EDITOR_RETRIES_PER_FILE,
  MAX_IMPLEMENTER_RETRIES_PER_FILE,
  COARSE_LIMB_BUDGET,
  emitJson,
} = require('./hook-utils');

function collectInvocations(args = {}) {
  const items = [];
  if (typeof args.TypeName === 'string' && args.TypeName) {
    items.push({
      type: args.TypeName,
      prompt: String(args.Prompt || args.Task || args.Target || ''),
    });
  }
  if (Array.isArray(args.Subagents)) {
    for (const s of args.Subagents) {
      if (s && typeof s.TypeName === 'string' && s.TypeName) {
        items.push({
          type: s.TypeName,
          prompt: String(s.Prompt || s.Task || s.Target || ''),
        });
      }
    }
  }
  return items;
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

  syncTurnState(state, payload.lastUserInput);

  const stepIdx = typeof payload.stepIdx === 'number' ? payload.stepIdx : state.lastStepIdx;
  if (typeof payload.stepIdx === 'number') {
    state.lastStepIdx = Math.max(state.lastStepIdx, payload.stepIdx);
  }

  const toolCall = payload.toolCall || {};
  const toolName = toolCall.name || '';
  const args = toolCall.args || {};

  if (toolName === 'invoke_subagent') {
    const items = collectInvocations(args);
    const count = Math.max(1, items.length);
    state.delegatedCalls += count;
    state.turnDelegatedCalls += count;

    for (const item of items) {
      if (item.type === 'fast-editor' || item.type === 'implementer' || item.type === 'self') {
        const paths = extractFilePathsFromText(item.prompt);
        const touchesSource = paths.length === 0 || paths.some((p) => isSourceFile(p));
        if (touchesSource) {
          state.unverifiedEdits = true;
          state.lastMutationStep = stepIdx;
        }
        if (responseHasPassingVerification(payload)) {
          state.unverifiedEdits = false;
          state.lastVerifiedStep = stepIdx;
          state.lastVerificationSource = 'edit-and-verify';
        }
        if (item.type === 'fast-editor') {
          for (const rawP of paths) {
            const norm = normalizePath(rawP);
            if (!norm) continue;
            state.fastEditorFileCounts[norm] = (state.fastEditorFileCounts[norm] || 0) + 1;
            const n = state.fastEditorFileCounts[norm];
            if (n > MAX_FAST_EDITOR_RETRIES_PER_FILE && !state.fastEditorWarned[norm]) {
              state.fastEditorWarned[norm] = true;
              appendNudge(
                state,
                `Repeated fast-editor attempts (${n}x) on '${path.basename(rawP)}'. Escalate to 'implementer' (flash) for non-trivial logic or apply directly in Brain.`
              );
            }
          }
        } else if (item.type === 'implementer') {
          for (const rawP of paths) {
            const norm = normalizePath(rawP);
            if (!norm) continue;
            state.implementerFileCounts[norm] = (state.implementerFileCounts[norm] || 0) + 1;
            const n = state.implementerFileCounts[norm];
            if (n > MAX_IMPLEMENTER_RETRIES_PER_FILE && !state.implementerWarned[norm]) {
              state.implementerWarned[norm] = true;
              appendNudge(
                state,
                `Repeated implementer attempts (${n}x) on '${path.basename(rawP)}'. Brain should take over and apply the fix directly.`
              );
            }
          }
        }
      } else if (item.type === 'verifier') {
        state.buildChecked = true;
        const raw = payload.toolResponse ?? payload.output ?? payload.result ?? '';
        const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
        if (!payload.error && !/STATUS:\s*FAIL\b/i.test(text)) {
          state.unverifiedEdits = false;
          state.lastVerifiedStep = stepIdx;
          state.lastVerificationSource = 'verifier';
        }
      }
    }

    if (
      state.turnDelegatedCalls > COARSE_LIMB_BUDGET &&
      state.turnDelegatedCalls >= state.delegationMilestoneWarned + 10
    ) {
      state.delegationMilestoneWarned = state.turnDelegatedCalls;
      appendNudge(
        state,
        `High Limb count (${state.turnDelegatedCalls} spawns this turn; target <=${COARSE_LIMB_BUDGET}). Batch multi-file work into coarse 'implementer' or 'code-searcher' runs.`
      );
    }

    saveState(convId, state, stateDir);
    return emitJson({});
  }

  if (toolName === 'schedule') {
    const poll = isPollingSchedule(args, state);
    if (poll.isPolling) {
      state.pollingAttempts += 1;
      state.directBloatCount += 1;
      appendNudge(
        state,
        'Zero-Polling Rule: Never poll background subagents with schedule/sleep timers. End your turn and wait for automatic wakeup.'
      );
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
      const targetPath = extractTargetPath(args);
      if (isSourceFile(targetPath)) {
        state.unverifiedEdits = true;
        state.lastMutationStep = stepIdx;
      }
      const linesChanged = estimateEditLines(toolName, args);
      if (linesChanged > 120) {
        state.largeWriteCount += 1;
        state.directBloatCount += 1;
        if (state.largeWriteCount >= 2) {
          appendNudge(
            state,
            "Multiple large writes (>120 lines) in Brain. Route complex/multi-file edits to 'implementer' (flash) or boilerplate to 'fast-editor' (flash_lite)."
          );
        }
      }
    }
  } else if (toolName === 'run_command') {
    const cmd = args.CommandLine || '';
    const kind = classifyShellCommand(cmd);
    if (kind === 'polling') {
      state.pollingAttempts += 1;
      state.directBloatCount += 1;
      appendNudge(
        state,
        'Zero-Polling Rule: Never use sleep/timeout polling in shell commands; wait passively for subagent wakeup.'
      );
    } else if (kind === 'build') {
      state.buildChecked = true;
      if (!isTargetedShellCheck(cmd)) {
        state.directBloatCount += 1;
        appendNudge(
          state,
          "Direct build/lint command ran in Brain context. Delegate broad builds/typechecks/lints to 'verifier' (flash_lite) to keep raw logs out of Brain history."
        );
      }
    } else if (kind === 'test') {
      if (!payload.error) {
        state.unverifiedEdits = false;
        state.lastVerifiedStep = stepIdx;
        state.lastVerificationSource = 'direct-test';
      }
      if (!isTargetedShellCheck(cmd)) {
        state.directBloatCount += 1;
        appendNudge(
          state,
          "Direct test command ran in Brain context. Delegate broad test suites to 'verifier' (flash_lite) to keep test output out of Brain history."
        );
      }
    } else if (kind === 'search') {
      state.directBloatCount += 1;
      appendNudge(
        state,
        "Direct search command ran in Brain context. Delegate code searches to 'code-searcher' (flash_lite) and request exact file:line citations."
      );
    }
  } else if (toolName === 'grep_search' || toolName === 'find_by_name') {
    state.directBloatCount += 1;
    state.directSearchCount += 1;
    appendNudge(
      state,
      "Direct search tool ran in Brain context. Batch multi-query searches into 'code-searcher' (flash_lite) for exact file:line citations and signatures."
    );
  } else if (toolName === 'read_file' || toolName === 'view_file') {
    const targetPath = extractTargetPath(args);
    const norm = normalizePath(targetPath);
    const readCheck = inspectReadRequest(args, payload);
    if (!readCheck.exempt) {
      state.directBloatCount += 1;
      appendNudge(
        state,
        "Unbounded/oversized file read ran in Brain context. Read <=300 lines in one call or delegate to 'code-searcher' (flash_lite)."
      );
    } else if (
      norm &&
      !isMetaOrSkillPath(norm, payload) &&
      readCheck.span !== null &&
      !readCheck.smallFile &&
      readCheck.span <= MAX_DIRECT_MICRO_READ_LINES
    ) {
      state.sameFileReadCounts[norm] = (state.sameFileReadCounts[norm] || 0) + 1;
      const count = state.sameFileReadCounts[norm];
      if (count > MAX_MICRO_READS_PER_FILE && !state.sameFileMicroReadWarned[norm]) {
        state.sameFileMicroReadWarned[norm] = true;
        appendNudge(
          state,
          `Multiple micro-reads (${count}x) on '${path.basename(targetPath)}'. Read up to 300 lines in one call (or small files <=250 lines unbounded) instead of slicing.`
        );
      }
    }
  }

  saveState(convId, state, stateDir);
  return emitJson({});
}

main().catch(() => emitJson({}));
