# Token-Efficient Subagents (`subagent-efficiency` v2.0)

A **Brain & Limbs** optimization plugin for **Google Antigravity** (Antigravity App, Antigravity IDE, and `agy` CLI) that isolates raw file reads, code searches, routine edits, builds, linters, and test runs inside lightweight `flash_lite` subagents—keeping the primary model's context window clean and reasoning costs minimal.

---

## Architecture: Brain & Limbs

- **The Brain (Primary Model):** Focuses strictly on planning, architectural reasoning, design decisions, and synthesizing final answers.
- **The Limbs (4 Pre-Registered `flash_lite` Subagents in `agents/`):** Execute scoped operational work in isolated contexts and return terse, structured signals with exact `file:line` citations:
  - **`code-searcher`** (`flash_lite`, read-only): File discovery, symbol grep, dependency tracing, and large/multi-file inspection.
  - **`fast-editor`** (`flash_lite`, write-enabled): Targeted edits, refactors, docstrings, boilerplate, and file creation.
  - **`builder`** (`flash_lite`, sandbox shell): Compiles, builds, typechecks (`tsc`, `cargo`, `mypy`, etc.), and linters (`eslint`, `ruff`); strips noisy logs and returns `file:line:col` error digests.
  - **`verifier`** (`flash_lite`, sandbox shell): Runs test suites and verifies diffs/assertions; returns pass/fail counts and exact failing `file:line` locations.

### Token Economic Impact

| Scenario | Direct Execution (Without Plugin) | Brain & Limbs (With Plugin) | Net Impact |
| :--- | :--- | :--- | :--- |
| **Grep / Search across 10 files** | Dumps 5,000–15,000 tokens into Brain context for every future turn | `code-searcher` inspects in isolation; returns exact `file:line` locations (~150 tokens) | **~90–98% token reduction** |
| **Build / Typecheck / Test loops** | Compiler & test logs flood Brain history across iterative fix cycles | `builder` & `verifier` strip noise and return exact failing `file:line` digests | **~80–95% log bloat prevented** |
| **Mechanical / Routine Edits** | Primary model burns high-tier output/reasoning tokens | `fast-editor` applies exact edits on `flash_lite` and reports modified lines | **~60–85% output/reasoning savings** |
| **Skill / Artifact / `<=80`-line read** | Subagent spawn adds unnecessary latency | Explicitly exempted so Brain workflows stay fast with zero overhead | **Zero negative-ROI overhead** |

---

## Signal-In / Signal-Out Precision Contract

Limbs communicate with the Brain using compact structured signals:

- **Signal-In (Brain → Limb):** `TARGET`, `TASK`, `DETAIL_LEVEL` (`summary` | `exact_lines` | `exact_snippets`), and `CONSTRAINTS`.
- **Signal-Out (Limb → Brain):** `STATUS` (`OK` | `FAIL` | `NOT_FOUND` | `AMBIGUOUS`), `LOCATIONS` (exact `path/to/file.ext:Lstart-Lend`), `SUMMARY` (1–5 terse bullets), optional `SNIPPETS` (when `exact_snippets` is requested or on failure), and `NEXT`.
- **Model Escalation:** Always start on `flash_lite`; escalate a single retry to `flash` only if a Limb returns `AMBIGUOUS` or fails twice on the same task.

---

## Lifecycle Hooks & Enforcement Modes

`hooks.json` configures five zero-dependency Node.js lifecycle hooks (exiting `0` safely across Windows, macOS, and Linux):

| Hook | Script | Purpose |
| :--- | :--- | :--- |
| `SessionStart` | `scripts/session-start.js` | Marks root Brain conversation and injects `[Brain & Limbs Protocol Active]`. |
| `PreToolUse` | `scripts/pre-tool-gate.js` | Intercepts high-bloat direct Brain tool calls (builds, tests, searches, workspace edits, unbounded reads) with a **1-shot redirect** (`soft-gate` default). Exempts subagents, `SKILL.md`/`.agents/`/`.gemini/`, artifacts, and `<=80`-line bounded reads. |
| `PostToolUse` | `scripts/post-tool-track.js` | Tracks `invoke_subagent` delegations (`fast-editor`, `builder`, `verifier`) and flags unverified edits or Brain drift. |
| `PreInvocation` | `scripts/pre-invocation.js` | Injects a single, non-repeating drift reminder only when Brain drift occurred (never spams every turn). |
| `Stop` | `scripts/stop-verify.js` | Prompts once (`continuationActive`-guarded) if workspace edits have not been checked by `verifier`. |

### Configuring Gate Mode (`AGY_EFFICIENCY_MODE`)

Set `AGY_EFFICIENCY_MODE` (or `"mode"` inside `$PLUGIN_DATA/config.json`):
- **`soft-gate`** *(default)*: Blocks an unmistakable direct Brain violation once per call signature and allows an explicit retry (preventing multi-turn retry loops while stopping accidental context dumps).
- **`advisory`**: Disables `PreToolUse` denials; relies on rules, `PreInvocation` drift notices, and `Stop` verification reminders.
- **`strict`**: Blocks all non-exempt direct Brain searches, workspace edits, builds, and tests even on retry.

---

## Repository Structure

```text
subagent-efficiency/
├── plugin.json                        # Plugin manifest (v2.0.0)
├── hooks.json                         # 5 lifecycle hooks configuration
├── assets/
│   └── logo.svg                       # Square plugin icon
├── agents/
│   ├── code-searcher.md               # Read-only search & exact-line limb
│   ├── fast-editor.md                 # Targeted editing limb
│   ├── builder.md                     # Build, compile, typecheck & lint limb
│   └── verifier.md                    # Test execution & verification limb
├── rules/
│   └── AGENTS.md                      # Brain & Limbs routing + Red Flags table
├── skills/
│   └── subagent-efficiency/
│       └── SKILL.md                   # SDO skill & Signal-In/Signal-Out templates
├── scripts/
│   ├── hook-utils.js                  # Shared state, classification & exemptions
│   ├── session-start.js
│   ├── pre-tool-gate.js
│   ├── post-tool-track.js
│   ├── pre-invocation.js
│   └── stop-verify.js
├── tests/
│   ├── hooks.test.js                  # Unit & stdin/stdout contract tests
│   └── plugin-validate.test.js        # Manifest, agent & strict CLI checks
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
