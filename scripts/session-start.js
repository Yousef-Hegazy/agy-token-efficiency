#!/usr/bin/env node
/**
 * Antigravity SessionStart hook for Token-Efficient Subagents.
 * Injects subagent registration and delegation directives at session initialization.
 */

let buffer = '';
let handled = false;

function finish() {
  if (handled) return;
  handled = true;
  const result = {
    injectSteps: [
      {
        systemMessage: {
          systemMessage:
            "[Token-Efficiency Protocol Active]\n" +
            "To drastically minimize token usage and latency across Antigravity 2.0 & IDE:\n" +
            "1. 'code-searcher' (Model: 'flash_lite', Read-only): Delegate file searching, symbol grep, and repository exploration here. Avoid reading full files into main context.\n" +
            "2. 'fast-editor' (Model: 'flash_lite', Write-enabled): Delegate small-to-medium edits, localized refactorings, documentation, and routine fixes here.\n" +
            "If these subagents are not yet registered in this session, call define_subagent once before first invocation."
        }
      }
    ]
  };
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { buffer += chunk; });
process.stdin.on('end', finish);

// Safety fallback timer if stdin does not emit EOF
setTimeout(finish, 1000);
