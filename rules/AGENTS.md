# Brain & Limbs Token-Efficiency Rules

**Optimize Total Cost = `(Brain_Turns × Avg_Context) + Limb_Cold_Starts`**, NOT merely bytes per Brain tool call.
Use a lean **Brain + 2 I/O Limbs** architecture: Brain performs all code edits directly on its warm 95%-discounted prompt cache, while 2 `flash_lite` I/O Limbs (`code-searcher` and `verifier`) keep raw discovery and compiler/test logs out of Brain's context.

---

## 1. Brain + 2 I/O Limbs Routing Matrix

| Task | Owner | Model Tier | Guidance |
| :--- | :--- | :--- | :--- |
| **Planning, hard debugging, and ALL code edits** | **Brain directly** | Primary | Edit directly on Brain's warm cache (use `/effort medium` during implementation). Use direct `grep_search`/`read_file` (`<=300` lines, or small files `<=250` lines / `10 KB`) for quick later lookups. |
| **Upfront broad discovery, multi-file tracing, `>300`-line files** | `code-searcher` | `flash_lite` | Cap to **`<= 2–3` upfront spawns**; batches parallel `grep_search`/`read_file` calls (`<= 6` turns) and returns verbatim signatures + exact imports. |
| **All builds, typechecks, linters, test suites & coverage** | `verifier` | `flash_lite` | Strict **2–4 turn** run-and-report pattern; keeps noisy logs out of Brain. Reuse idle `verifier` for max **2–3** quick retries; spawn fresh after large failure dumps or `>5` min gaps. |
| **Live browser / UI checks** | `browser` | `flash` | Visual/console check summary. |

Both plugin Limbs (`code-searcher`, `verifier`) are pre-registered in `agents/*.md` — invoke directly with `invoke_subagent` (no `define_subagent` needed).

---

## 2. Coarse-Grained Batching, Zero-Polling & Shell Discipline

1. **Coarse-grained budget (`<= 6–8` Limbs/turn):** Cap `code-searcher` to `<= 2–3` upfront spawns. Use direct Brain `grep_search`/`read_file` for quick later lookups.
2. **Zero-Polling Rule:** **NEVER** call `manage_task(status)`, `schedule`, `sleep`, `Start-Sleep`, or `timeout /t` to poll background tasks. Dispatch parallel Limbs and **end your turn**—Antigravity wakes Brain automatically on completion.
3. **Send complete Signal-In specs:** Include `TARGET`, `TASK`, `DETAIL_LEVEL` (`summary` | `exact_lines` | `exact_snippets`), `CONSTRAINTS` (OS shell dialect + single-run test/check command).
4. **Shell & single-run discipline:** Respect the `SessionStart` shell contract. On Windows PowerShell 5.1, **forbid `&&`** (use `; if ($LASTEXITCODE -eq 0) { ... }` or separate commands). Always use non-interactive test flags (`vitest run`, `cargo test -- --nocapture`, `pytest -q`).

---

## 3. Red Flags — STOP and Rebalance

| Excuse / Thought | Reality |
| :--- | :--- |
| "Let me check `manage_task(status)` or set a `schedule`/`sleep` timer" | **Zero-Polling Rule:** End your turn with no tool calls; reactive wakeup notifies Brain automatically. |
| "I'll read this 800-line file unbounded in Brain" | Bounded reads `<= 300` lines (or small files `<= 250` lines / `10 KB`) are allowed; delegate large reads to `code-searcher`. |
| "I'll run `npm test` / `cargo test` across the whole repo directly" | Full-suite logs bloat every future turn. Delegate noisy builds/tests to `verifier`. |
| "I'll chain commands with `&&` on Windows PowerShell" | PowerShell 5.1 rejects `&&`; use `; if ($LASTEXITCODE -eq 0) { ... }` or separate commands. |
