# Token-Efficient Subagents (`subagent-efficiency` v2.0)

A **3-tier Brain & Limbs** optimization plugin for **Google Antigravity** (Antigravity App, Antigravity IDE, and `agy` CLI) that routes work across top-tier Brain reasoning, mid-tier `flash` implementation, and `flash_lite` execution—preventing raw log bloat, delegation-loop failures, and polling overhead.

---

## Optimization Objective & 3-Tier Roster

We optimize **Total Cost**, not merely bytes per Brain tool call:

$$\text{Total Cost} = (\text{Brain\_Turns} \times \text{Avg\_Context}) + \text{Limb\_Cold\_Starts}$$

Every Limb spawn pays an uncached cold-start cost plus a Brain orchestration turn, while under-powered models burn multi-turn retry loops on complex logic. Routing each task to the right tier prevents both extremes:

| Role / Tier | Owner | Model | Scope |
| :--- | :--- | :--- | :--- |
| **Orchestrator & Surgical Fixer** | **Brain** | Top-tier (Primary) | Architecture, planning, hard debugging, bounded direct reads (`<=300` lines / small files `<=250` lines & `10 KB`), and `<50`-line surgical edits already in context. |
| **Complex Code Author** | **`implementer`** | `flash` (mid-tier) | Multi-file features, large refactors, complex/type-heavy logic (Rust lifetimes/borrowing/match arms, parsers, state logic) + targeted self-verify (`VERIFICATION: PASS \| FAIL`). |
| **Mechanical Editor** | **`fast-editor`** | `flash_lite` | Strictly mechanical boilerplate, repetitive renames, scaffolding, or verbatim replacements with exact lines & signatures supplied by Brain. |
| **Recon & Discovery** | **`code-searcher`** | `flash_lite` | Single-shot comprehensive discovery, multi-file tracing, `>300`-line files; returns exact `file:line`, verbatim signatures, and exact imports in `<=6–8` turns. |
| **Consolidated Runner** | **`verifier`** | `flash_lite` | All standalone builds, typechecks, linters, test suites, combined compile+test pipelines (`cargo test`, `tsc` + `vitest run`), and diff audits with 15–20 line failure snippets. |

---

## Anti-Patterns Prevented (Production Telemetry Guardrails)

1. **Zero-Polling Rule (No `schedule` / `sleep` loops):** `PreToolUse` hard-blocks `schedule` polling timers and shell `sleep`/`Start-Sleep`/`timeout /t` loops; Brain dispatches parallel Limbs and ends its turn for automatic reactive wakeup.
2. **Realistic Read Thresholds (No `<=80`-line thrashing):** `PreToolUse` allows bounded reads up to **300 lines** (capped against minified mega-lines at `24 KB`) and unbounded reads of small files **<= 250 lines / 10 KB**, only hard-blocking genuinely large/unknown unbounded reads with exact recommended `StartLine`/`EndLine` bounds.
3. **Zero Turn-Wasting Edit/Search Rejections (`soft-gate`):** Direct Brain edits, quick `grep_search`/`find_by_name`, and targeted single-file checks run without `PreToolUse` rejections in `soft-gate` mode, eliminating retry-turn overhead.
4. **Coarse-Grained Batching & Tiered Anti-Thrashing Nudges:** Target **<= 10–15 Limbs** per complex task. `PostToolUse` + `PreInvocation` nudge on `>3` micro-reads on the same file, `>2` `fast-editor` retries on one file (escalate to `implementer`), `>2` `implementer` retries on one file (Brain takeover), or `>15` Limb spawns in a turn.
5. **Smarter `Stop` Hook (No False-Positive Rejections):** `stop-verify.js` stays silent when only non-source files (`.md`, `.txt`, images) changed, when verification passed after the last source mutation, or when `implementer`, `fast-editor` (`VERIFICATION: PASS`), or `verifier` already passed in state or transcript.
6. **OS/Shell Dialect & Single-Run Enforcement:** `SessionStart` detects Windows PowerShell 5.1 vs `pwsh` 7+ vs POSIX `sh`/`bash`, forbidding `&&` chaining on PS 5.1 and mandating non-interactive single-run test flags (`vitest run`, never watch mode/background daemons).

---

## Signal-In / Signal-Out Contract

- **Signal-In (Brain → Limb):** `TARGET`, `TASK`, `DETAIL_LEVEL` (`summary` | `exact_lines` | `exact_snippets`), and `CONSTRAINTS` (including OS shell rules & verification command).
- **Signal-Out (Limb → Brain):** `STATUS` (`OK` | `FAIL` | `NOT_FOUND` | `AMBIGUOUS`), `LOCATIONS` (`path/to/file.ext:Lstart-Lend`), `VERIFICATION` (for `implementer` & `fast-editor`), `SIGNATURES_AND_IMPORTS` (for `code-searcher`), `COUNTS` (for `verifier`), `SUMMARY`, self-contained `SNIPPETS` (15–20 lines on failure), and `NEXT`.
- **Escalation Ladder:** `fast-editor` (`flash_lite`) → `implementer` (`flash`) → Brain direct takeover after max **2** retries per tier.

---

## Lifecycle Hooks & Gate Modes

`hooks.json` configures five zero-dependency Node.js lifecycle hooks (exiting `0` safely across Windows, macOS, and Linux):

| Hook | Script | Purpose |
| :--- | :--- | :--- |
| `SessionStart` | `scripts/session-start.js` | Marks root Brain conversation, detects OS/shell dialect, and injects 3-tier Total-Cost + Zero-Polling + test-flag rules. |
| `PreToolUse` | `scripts/pre-tool-gate.js` | Hard-blocks `schedule`/shell polling loops; gates unbounded reads of large files (`>250` lines / `>10 KB`) and broad shell build/test/search floods (routing builds & tests to `verifier`), while permitting direct edits, `<=300`-line reads, small files, `grep_search`, and single-file checks in `soft-gate`. |
| `PostToolUse` | `scripts/post-tool-track.js` | Tracks Limb spawns, same-file micro-reads, repeat `fast-editor`/`implementer` retries, polling attempts, source vs non-source mutations, and inline `VERIFICATION: PASS` results. |
| `PreInvocation` | `scripts/pre-invocation.js` | Injects a single, non-repeating drift/escalation notice only when triggered. |
| `Stop` | `scripts/stop-verify.js` | Skips cleanly on non-source edits or verified mutations (including transcript verification from `verifier`, `implementer`, or `fast-editor`); prompts once (`continuationActive` & per-turn guarded) only if unverified source edits remain. |

### Configuring Gate Mode (`AGY_EFFICIENCY_MODE`)

Set `AGY_EFFICIENCY_MODE` (or `"mode"` inside `$PLUGIN_DATA/config.json`):
- **`soft-gate`** *(default)*: Hard-blocks polling loops; 1-shot redirects unbounded large reads (with exact bounds) and broad shell build/test/search floods; permits direct Brain edits, `<=300`-line reads, small files, `grep_search`, and single-file checks without retry rejections.
- **`advisory`**: Disables `PreToolUse` denials; relies on rules, `PreInvocation` thrashing/escalation notices, and `Stop` verification.
- **`strict`**: Blocks all non-exempt direct Brain searches, workspace edits, builds, tests, oversized reads, and polling loops.

---

## Repository Structure

```text
subagent-efficiency/
├── plugin.json                        # Plugin manifest (v2.0.0)
├── hooks.json                         # 5 lifecycle hooks configuration (includes schedule)
├── assets/
│   └── logo.svg                       # Square plugin icon
├── agents/
│   ├── code-searcher.md               # flash_lite: single-shot recon, signatures & 6-8 turn cap
│   ├── implementer.md                 # flash: complex logic, multi-file edits + self-verify
│   ├── fast-editor.md                 # flash_lite: strictly mechanical edits + self-verify
│   └── verifier.md                    # flash_lite: consolidated build/lint/test runner
├── rules/
│   └── AGENTS.md                      # 3-tier routing matrix, Zero-Polling, Coarse Batching & Red Flags
├── skills/
│   └── subagent-efficiency/
│       └── SKILL.md                   # 3-tier Signal-In templates & escalation protocol
├── scripts/
│   ├── hook-utils.js                  # Read thresholds, polling/shell/source/transcript helpers
│   ├── session-start.js
│   ├── pre-tool-gate.js
│   ├── post-tool-track.js
│   ├── pre-invocation.js
│   └── stop-verify.js
├── tests/
│   ├── hooks.test.js                  # Unit & stdin/stdout contract tests
│   └── plugin-validate.test.js        # Manifest, 3-tier agent & strict CLI checks
├── .gitignore
└── README.md
```

---

## Installation & Verification

```bash
# Validate strictly with Antigravity CLI
agy plugin validate --strict .

# Run automated hook and plugin contract tests (Node >= 18)
node --test tests/*.test.js

# Install from local directory or GitHub
agy plugin install /path/to/agy-token-efficiency
agy plugin install https://github.com/Yousef-Hegazy/agy-token-efficiency.git
```
