---
name: subagent-efficiency
description: >-
  Use when searching codebases, reading large or multiple files, applying
  edits or refactors, running builds, linters, or typechecks, executing tests,
  verifying fixes, or when direct tool calls risk bloating Brain context.
---

# Brain & Limbs Delegation Protocol

The Brain plans, decides, and synthesizes. Four pre-registered `flash_lite` Limbs (`code-searcher`, `fast-editor`, `builder`, `verifier`) execute all heavy file, edit, build, and verification work in isolated contexts.

---

## 1. Signal-In Templates (`invoke_subagent`)

Always invoke with `Model: "flash_lite"` and `Workspace: "inherit"` (unless isolating parallel branches with `"branch"`/`"share"`).

### Search / Exact Line Lookup (`code-searcher`)
```text
TARGET: <repo/dir/file/symbol>
TASK: Locate all definitions and call sites of <symbol>.
DETAIL_LEVEL: exact_lines | exact_snippets
CONSTRAINTS: Read-only. Return exact file:start-end lines and minimal snippets only.
```

### Targeted Code Edit (`fast-editor`)
```text
TARGET: <path/to/file.ext:Lstart-Lend>
TASK: Replace <exact target or behavior> with <exact replacement>.
DETAIL_LEVEL: exact_lines
CONSTRAINTS: Edit only the listed files. Return modified line ranges.
```

### Build / Typecheck / Lint (`builder`)
```text
TARGET: <build/lint command, e.g. npx tsc --noEmit && npm run build>
TASK: Run command and extract root compiler/linter errors only.
DETAIL_LEVEL: summary | exact_snippets
CONSTRAINTS: Do not edit files. Omit passing files and progress noise.
```

### Test & Verification (`verifier`)
```text
TARGET: <test command + changed file paths>
TASK: Run tests and confirm assertions/requirements hold without weakened checks.
DETAIL_LEVEL: summary | exact_snippets
CONSTRAINTS: Do not edit files. Report pass/fail counts and exact failing file:line locations.
```

---

## 2. Escalation & Hook Modes

- **Model escalation:** If a `flash_lite` Limb returns `STATUS: AMBIGUOUS` or fails twice on the same task, re-invoke that single step with `Model: "flash"` using the prior Limb's exact `LOCATIONS` output.
- **Built-in fallback:** Only if native plugin agents are unavailable in the harness, use `research` (`Model: "flash_lite"`) for read/search and `self` (`Model: "flash_lite"`) for edits/builds/verification, appending the Signal-Out contract above.
- **Runtime gate modes:** `AGY_EFFICIENCY_MODE` supports `soft-gate` (default, 1-shot redirect per call signature), `advisory` (nudges only), and `strict` (always blocks non-exempt Brain tool calls).
