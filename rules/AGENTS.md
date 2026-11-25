# Brain & Limbs Token-Efficiency Rules

**Optimize Total Cost = `(Brain_Turns × Avg_Context) + Limb_Cold_Starts`**, NOT merely bytes per Brain tool call.
Use a **3-tier model roster** so simple recon/mechanical/runner jobs stay cheap on `flash_lite`, non-trivial multi-file implementation runs on mid-tier `flash`, and Brain reserves top-tier tokens for planning, hard debugging, and surgical edits already in context.

---

## 1. 3-Tier Routing Matrix

| Task | Owner | Model Tier | Guidance |
| :--- | :--- | :--- | :--- |
| **Architecture, planning, hard debugging, `<50`-line surgical edits in context** | **Brain directly** | Top-tier (Primary) | Also read known files/sections directly (`<=300` lines, or small files `<=250` lines / `10 KB`) in ONE call. |
| **Complex/type-heavy logic, large or multi-file features & refactors** | `implementer` | `flash` (mid-tier) | Handles Rust borrow/match semantics, parsers, state logic; runs targeted self-verify (`VERIFICATION: PASS \| FAIL`), max 2 retries. |
| **Strictly mechanical edits, boilerplate, repetitive renames, scaffolding** | `fast-editor` | `flash_lite` | ONLY when Brain supplies exact `file:line`, exact imports/signatures, and verbatim replacement; escalates to `implementer` on ambiguity/failure. |
| **Broad discovery, multi-file grep/tracing, files `>300` lines** | `code-searcher` | `flash_lite` | Batch related questions into 1 searcher (or 1 wave of 2–3 max); require `exact_lines`/`exact_snippets` + verbatim signatures & imports. |
| **All builds, typechecks, linters, test suites, combined pipelines & diff audits** | `verifier` | `flash_lite` | Single consolidated shell runner; non-interactive flags only (`vitest run`); returns self-contained 15–20 line failure snippets. |
| **Live browser / UI checks** | `browser` | `flash` | Visual/console check summary. |

All 4 plugin Limbs (`code-searcher`, `fast-editor`, `implementer`, `verifier`) are pre-registered in `agents/*.md` — invoke directly with `invoke_subagent` (no `define_subagent` needed).

---

## 2. Coarse-Grained Batching, Zero-Polling & Escalation

1. **Coarse-grained budget (`<= 10–15` Limbs):** Target `<= 10–15` Limbs total on complex multi-file tasks. Never fragment into 15+ micro-searchers or 20+ micro-edits.
2. **Zero-Polling Rule:** **NEVER** call `schedule`, `sleep`, `Start-Sleep`, or `timeout /t` timers to poll or wait on background subagents. Dispatch independent Limbs in parallel and **end your turn**—Antigravity wakes Brain automatically when Limbs finish.
3. **Send complete Signal-In specs:** Include `TARGET`, `TASK`, `DETAIL_LEVEL` (`summary` | `exact_lines` | `exact_snippets`), `CONSTRAINTS` (OS shell dialect + single-run test/check command).
4. **3-tier escalation ladder:** If `fast-editor` (`flash_lite`) fails or returns `AMBIGUOUS`, escalate to `implementer` (`flash`) or Brain. After max **2** `implementer` retries on the same file, Brain takes over directly.
5. **Shell & single-run discipline:** Respect the `SessionStart` shell dialect contract. On Windows PowerShell 5.1, **forbid `&&`** (use `; if ($LASTEXITCODE -eq 0) { ... }` or separate commands). Always use non-interactive test flags (`vitest run`, `cargo test -- --nocapture`, `pytest -q`).

---

## 3. Direct-Action Boundaries & Red Flags

Brain acts directly for: `SKILL.md`/rule/artifact reads & writes, bounded reads `<= 300` lines, small files `<= 250` lines / `10 KB`, hard debugging or `< 50`-line surgical edits already in context, quick targeted `grep_search`, and targeted single-file checks.

### Red Flags — STOP and Rebalance

| Excuse / Thought | Reality |
| :--- | :--- |
| "Let me set a `schedule` timer to check if the subagent finished" | **Zero-Polling Rule:** Reactive wakeup notifies Brain automatically; timer polling burns whole Brain turns. |
| "I'll split this 240-line read into three 80-line calls" | Bounded reads up to **300 lines** (and small files `<=250` lines) are allowed in 1 direct call. |
| "I'll send this Rust borrow/match or multi-file feature to `fast-editor` (`flash_lite`)" | `fast-editor` is strictly mechanical; route complex/multi-file edits to `implementer` (`flash`) or edit `<50` lines directly in Brain. |
| "I'll run a separate build Limb and test Limb for `cargo check` + `cargo test`" | `verifier` consolidates ALL build, lint, and test runs into one shell-safe Limb. |
| "I'll run `npm test` / `cargo test` across the whole repo directly" | Full-suite logs bloat every future turn. Delegate broad builds/tests to `verifier`. |
| "I'll chain commands with `&&` on Windows PowerShell" | PowerShell 5.1 rejects `&&`; use `; if ($LASTEXITCODE -eq 0) { ... }` or separate commands. |
