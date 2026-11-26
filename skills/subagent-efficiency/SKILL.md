---
name: subagent-efficiency
description: >-
  Use when planning multi-file codebase work, routing across the lean Brain + 2
  I/O Limbs architecture (code-searcher and verifier on flash_lite), preventing
  polling loops, or verifying builds and tests with minimal total tokens.
---

# Brain & Limbs Delegation Protocol (Brain + 2 I/O Limbs)

Optimize **Total Cost = `(Brain_Turns × Avg_Context) + Limb_Cold_Starts`**, keeping Brain's warm 95%-discounted prompt cache for editing while offloading noisy I/O to 2 `flash_lite` Limbs:

- **Brain (primary):** Architecture, planning, hard debugging, **ALL code edits directly** (use `/effort medium` during implementation), bounded reads (`<= 300` lines / small files `<= 250` lines & `<= 10 KB`), and quick later `grep_search`/`read_file` lookups.
- **`code-searcher` (`flash_lite`):** Upfront broad discovery, multi-file tracing, `> 300`-line files (`<= 2–3` spawns, `<= 6` turns); returns verbatim signatures + exact imports.
- **`verifier` (`flash_lite`):** Consolidated 2–4 turn runner for ALL noisy builds, typechecks, linters, test suites, coverage, and diff audits.

---

## 1. Batching, Bounded Reuse & Zero-Polling

- **Upfront Recon Cap (`<= 2–3` `code-searcher` spawns):** Batch related recon upfront (`<= 6–8` Limbs/turn); use direct Brain `grep_search`/`read_file` for quick later lookups.
- **Bounded `verifier` Reuse:** Reuse an idle `verifier` (via `send_message`) for max **2–3** quick consecutive retries; spawn fresh after large failure dumps or `> 5` min gaps.
- **Zero-Polling Rule:** **NEVER** call `manage_task(status)`, `schedule`, `sleep`, `Start-Sleep`, or `timeout /t` to poll background tasks. End your turn and wait for automatic wakeup.

---

## 2. Signal-In Templates (`invoke_subagent`)

Respect the `SessionStart` OS shell contract—on Windows PowerShell 5.1, **never use `&&`** (use `; if ($LASTEXITCODE -eq 0) { ... }`).

### Comprehensive Recon (`code-searcher`, `Model: "flash_lite"`)
```text
TARGET: <repo/dir/files/symbols>
TASK: Locate all definitions, call sites, types, DB/API method names, and import paths for <topic>.
DETAIL_LEVEL: exact_lines | exact_snippets
CONSTRAINTS: Read-only. Batch parallel grep_search/read_file calls. Return verbatim function/type signatures, exact import paths, and file:Lstart-Lend ranges in <=6 turns.
```

### Consolidated Build / Lint / Test Verification (`verifier`, `Model: "flash_lite"`)
```text
TARGET: <build/lint/single-run test command, e.g. npx tsc --noEmit; if ($LASTEXITCODE -eq 0) { npx vitest run } | cargo test -- --nocapture> + <changed files>
TASK: Run build/lint/tests sequentially on Turn 1 and report verbatim exit codes, counts, and coverage.
DETAIL_LEVEL: exact_snippets
CONSTRAINTS: Foreground single-run only (never watch mode/daemons; no '&&' on PS 5.1; sequential cargo runs). If async, end turn immediately—never poll manage_task(status). Include VERBATIM_SUMMARY and 15-20 line snippets on FAIL.
```

---

## 3. Stateless Hook Safeguards

- **`SessionStart`:** Detects OS/shell dialect (forbidding `&&` on Windows PowerShell 5.1) and injects the Brain + 2 I/O Limbs & Zero-Polling banner.
- **`PreToolUse`:** Fail-open stateless gate enforcing:
  1. **Zero-Polling (Brain + all Limbs):** Blocks `manage_task(Action: "status")`, one-shot `schedule` timers, and shell `sleep`/`timeout /t` loops.
  2. **Large Unbounded Reads (Brain only):** Allows bounded reads `<= 300` lines (`<= 24 KB`) and small files (`<= 250` lines & `<= 10 KB`); blocks unbounded large reads with an actionable line-range hint. Never blocks `edit_file`, `write_file`, `grep_search`, `find_by_name`, or normal `run_command`.
- **Built-in Fallback:** Only if plugin agents are unavailable, use `research` (`flash_lite`) for read/search and `self` (`flash_lite`) for verification.
