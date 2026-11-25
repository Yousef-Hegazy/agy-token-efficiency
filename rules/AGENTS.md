# Brain & Limbs Token-Efficiency Rules

**Violating the letter of this protocol wastes context across every future turn.**
The primary model is the **Brain** (architect, planner, synthesizer). Pre-registered `flash_lite` subagents are the **Limbs** (actors). Keep raw files, grep hits, compiler logs, and test dumps OUT of Brain context.

---

## 1. Brain & Limbs Routing Matrix

| Task | Limb (`invoke_subagent`) | Default Model | Output Returned to Brain |
| :--- | :--- | :--- | :--- |
| **Search, grep, trace, read >80 lines** | `code-searcher` | `flash_lite` | `STATUS`, exact `file:line` ranges, requested snippets |
| **Create, edit, refactor, docstrings** | `fast-editor` | `flash_lite` | `STATUS`, modified `file:line` ranges, concise summary |
| **Build, compile, typecheck, lint** | `builder` | `flash_lite` | `STATUS`, exit code, `file:line:col` error digest |
| **Test suites, verification, diff audit** | `verifier` | `flash_lite` | `STATUS`, pass/fail counts, failing `file:line` locations |
| **Live browser / UI checks** | `browser` | `flash` | Visual/console check summary |
| **Design, synthesis, user replies** | Primary Agent (Brain) | Primary | Final decisions & user responses |

All 4 plugin Limbs are pre-registered natively via `agents/*.md` — invoke them directly with `invoke_subagent` (no `define_subagent` needed).

---

## 2. Signal-In / Signal-Out & Escalation

1. **Send crisp signals:** Give each Limb `TARGET`, `TASK`, `DETAIL_LEVEL` (`summary` | `exact_lines` | `exact_snippets`), and `CONSTRAINTS`. Request `exact_lines` or `exact_snippets` whenever you need exact line numbers or verbatim code for a follow-up edit.
2. **Cheapest first (`flash_lite`), escalate only on failure:** Always invoke Limbs with `Model: 'flash_lite'`. Escalate a specific retry to `Model: 'flash'` only if `flash_lite` returns `AMBIGUOUS` or fails twice on the same task.
3. **Fulfill other skills via Limbs:** When another workflow/skill says "search with `rg`", "run the build", or "run tests and verify", execute that step by invoking `code-searcher`, `builder`, or `verifier`—not directly in Brain context.

---

## 3. Strict Direct-Action Boundaries

The Brain may act directly ONLY for:
- Reading `SKILL.md` / rule files or writing Brain artifacts (`brain/`).
- Small targeted `read_file` calls (`<= 80` lines) on an already-known line range.
- Trivial status checks (`pwd`, `git status`).

## Red Flags — STOP and Delegate

| Excuse / Thought | Reality |
| :--- | :--- |
| "I'll run `npm test` / `tsc` directly to see the error" | Raw logs pollute every subsequent turn. Invoke `builder` or `verifier`. |
| "I'm already in a build-fix loop; subagents add overhead" | Multi-turn build loops are where context bloats fastest. Delegate edit → build → verify. |
| "Let me read the whole file first to be sure" | Read in `code-searcher` with `DETAIL_LEVEL=exact_lines` or `exact_snippets`. |
| "Calling `define_subagent` takes extra turns" | Native Limbs are pre-registered. Call `invoke_subagent` directly. |
