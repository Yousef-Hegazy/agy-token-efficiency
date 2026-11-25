---
name: subagent-efficiency
description: >-
  Use when planning multi-file codebase work, routing across the 3-tier Brain,
  implementer (flash), and flash_lite Limb roster, preventing polling loops and
  retry spirals, or verifying builds and tests with minimal total tokens.
---

# Brain & Limbs Delegation Protocol (3-Tier Total-Cost Balanced)

Optimize **Total Cost = `(Brain_Turns × Avg_Context) + Limb_Cold_Starts`**, routing each task to the cheapest tier that succeeds on the first pass:

- **Brain (top-tier):** Architecture, planning, hard debugging, bounded direct reads (`<= 300` lines / small files `<= 250` lines & `<= 10 KB`), and `< 50`-line surgical edits already in context.
- **`implementer` (`flash`, mid-tier):** Complex/type-heavy logic (Rust borrow/match semantics, parsers, state logic), large or multi-file features + targeted self-verification.
- **`fast-editor` (`flash_lite`):** Strictly mechanical edits—boilerplate, repetitive renames, scaffolding, or verbatim replacements with exact `file:line` and signatures.
- **`code-searcher` (`flash_lite`):** Broad discovery, multi-file tracing, `> 300`-line files; returns verbatim signatures and exact imports.
- **`verifier` (`flash_lite`):** Consolidated runner for ALL builds, typechecks, linters, test suites, combined compile+test pipelines (`cargo test`, `tsc` + `vitest run`), and diff audits.

---

## 1. Coarse-Grained Batching & Zero-Polling

- **Coarse-Grained Batching (`<= 10–15` Limbs/task):** Batch all related recon into **1 comprehensive `code-searcher`** (or 1 parallel wave of at most 2–3 non-overlapping searchers). Batch multi-file feature edits into coarse `implementer` runs rather than dozens of micro-Limbs.
- **Zero-Polling Rule:** **NEVER** call `schedule`, `sleep`, `Start-Sleep`, or `timeout /t` to poll background subagents. Dispatch parallel Limbs and **end your turn**—Antigravity wakes Brain automatically on completion.

---

## 2. Signal-In Templates (`invoke_subagent`)

Respect the `SessionStart` OS shell contract—on Windows PowerShell 5.1, **never use `&&`** (use `; if ($LASTEXITCODE -eq 0) { ... }` or separate commands). Use `Workspace: "inherit"` unless isolating concurrent writers with `"branch"`/`"share"`.

### Comprehensive Recon (`code-searcher`, `Model: "flash_lite"`)
```text
TARGET: <repo/dir/files/symbols>
TASK: Locate all definitions, call sites, types, DB/API method names, and import paths for <topic>.
DETAIL_LEVEL: exact_lines | exact_snippets
CONSTRAINTS: Read-only. Return verbatim function/type signatures, exact import paths, and file:Lstart-Lend ranges in <=6-8 turns.
```

### Complex / Multi-File Implementation (`implementer`, `Model: "flash"`)
```text
TARGET: <files/feature scope + verified signatures/imports>
TASK: Implement <complex logic or multi-file feature> cleanly.
DETAIL_LEVEL: exact_lines
CONSTRAINTS: Self-verify via <targeted check, e.g. cargo check / npx tsc --noEmit / npx vitest run file.test.ts> (no '&&' on PS 5.1); max 2 retries; return VERIFICATION + 15-20 line SNIPPETS on FAIL.
```

### Mechanical / Boilerplate Edit (`fast-editor`, `Model: "flash_lite"`)
```text
TARGET: <path/to/file.ext:Lstart-Lend>
TASK: Apply verbatim mechanical replacement using exact imports [<imports>] and signatures [<exact API/DB names>].
DETAIL_LEVEL: exact_lines
CONSTRAINTS: Mechanical only; self-verify via <targeted check>; stop and escalate to implementer/Brain after max 2 failed attempts.
```

### Consolidated Build / Lint / Test Verification (`verifier`, `Model: "flash_lite"`)
```text
TARGET: <build/lint/single-run test command, e.g. npx tsc --noEmit; if ($LASTEXITCODE -eq 0) { npx vitest run } | cargo test -- --nocapture> + <changed files>
TASK: Run build/lint and/or tests and confirm assertions hold without weakened checks.
DETAIL_LEVEL: exact_snippets
CONSTRAINTS: Foreground single-run only (never watch mode/daemons; no '&&' on PS 5.1). Max 2 retries. Include 15-20 line snippets on FAIL.
```

---

## 3. Escalation, Anti-Thrashing & Gate Modes

- **3-Tier Escalation Ladder:**
  1. If `fast-editor` (`flash_lite`) returns `AMBIGUOUS` or fails twice on the same file -> escalate to `implementer` (`flash`) or apply directly in Brain.
  2. If `implementer` (`flash`) fails twice (`> 2` retries on the same file) -> Brain takes over directly.
- **Hook Safeguards (`AGY_EFFICIENCY_MODE`):**
  - `soft-gate` *(default)*: Allows bounded reads `<= 300` lines, small files `<= 250` lines/`10 KB`, direct Brain edits, quick `grep_search`, and single-file targeted checks without turn-wasting rejections; blocks `schedule`/sleep polling loops, unbounded large reads (with exact recommended line bounds), and raw shell log floods; injects concise `PreInvocation` nudges on thrashing (`>3` micro-reads on one file, `>2` `fast-editor` retries -> `implementer`, `>2` `implementer` retries -> Brain, `>15` Limb spawns).
  - `advisory`: Disables `PreToolUse` denials; relies on `PreInvocation` nudges and `Stop` verification.
  - `strict`: Blocks all non-exempt direct Brain searches, workspace edits, builds, tests, and polling loops.
- **Built-in Fallback:** Only if plugin agents are unavailable, use `research` (`flash_lite`) for read/search and `self` (`flash`/`flash_lite`) for edits/verification.
