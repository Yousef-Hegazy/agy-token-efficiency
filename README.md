# Token-Efficient Subagents (`subagent-efficiency` v2.0)

A tiny, stateless **Brain + 2 I/O Limbs** plugin for **Google Antigravity** where Brain edits code directly on its warm 95%-discounted prompt cache, while two `flash_lite` I/O Limbs (`code-searcher` and `verifier`) absorb noisy codebase discovery and build/test output.

---

## Optimization Objective & 2-Limb Architecture

$$\text{Total Cost} = (\text{Brain\_Turns} \times \text{Avg\_Context}) + \text{Limb\_Cold\_Starts}$$

| Role / Tier | Owner | Model | Scope |
| :--- | :--- | :--- | :--- |
| **Orchestrator & Code Author** | **Brain** | Primary | Planning, hard debugging, **ALL code edits directly** (use `/effort medium` during implementation), bounded reads (`<=300` lines / small files `<=250` lines & `10 KB`), and quick `grep_search`/`read_file` lookups. |
| **Recon & Discovery** | **`code-searcher`** | `flash_lite` | Upfront broad discovery, multi-file tracing, `>300`-line files (`<=2–3` spawns, `<=6` turns); returns verbatim signatures + exact imports. |
| **Consolidated Runner** | **`verifier`** | `flash_lite` | Strict **2–4 turn** sequential runner for noisy builds, lints, tests, and coverage with `VERBATIM_SUMMARY` metrics and 15–20 line failure snippets. |

---

## Stateless Lifecycle Hooks (2 Events Only)

`hooks.json` configures two zero-dependency, stateless Node.js hooks:

| Hook | Script | Purpose |
| :--- | :--- | :--- |
| `SessionStart` | `scripts/session-start.js` | Detects OS/shell dialect (forbidding `&&` on Windows PowerShell 5.1) and injects the Brain + 2 I/O Limbs & Zero-Polling banner. |
| `PreToolUse` | `scripts/pre-tool-gate.js` | Fail-open stateless gate: (1) blocks `manage_task(status)`, one-shot `schedule`, and shell `sleep` polling for **both Brain and subagents**; (2) blocks large unbounded reads (`>250` lines / `>10 KB`) for **Brain only**. Never blocks edits, searches, or normal commands. |

---

## Repository Structure

```text
subagent-efficiency/
├── plugin.json                        # Plugin manifest (v2.0.0)
├── hooks.json                         # 2 stateless hooks (SessionStart, PreToolUse)
├── assets/logo.svg                    # Square plugin icon
├── agents/
│   ├── code-searcher.md               # flash_lite: parallel recon, signatures & <=6 turn target
│   └── verifier.md                    # flash_lite: 2-4 turn sequential runner & verbatim metrics
├── rules/AGENTS.md                    # Brain + 2 I/O Limbs routing matrix, Zero-Polling & Red Flags
├── skills/subagent-efficiency/SKILL.md# 2-Limb Signal-In templates & hook safeguards
├── scripts/
│   ├── session-start.js               # OS/shell detection & 5-line banner
│   └── pre-tool-gate.js               # Stateless Zero-Polling + Large-Read gate
└── tests/
    ├── hooks.test.js                  # Hook contract tests
    └── plugin-validate.test.js        # Manifest, 2-Limb agent & strict CLI checks
```

---

## Installation & Verification

```bash
agy plugin validate --strict .
node --test tests/hooks.test.js tests/plugin-validate.test.js
agy plugin install /path/to/agy-token-efficiency
```
