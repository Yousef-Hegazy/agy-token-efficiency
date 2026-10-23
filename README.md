# Token-Efficient Subagents (`subagent-efficiency`)

A lightweight optimization plugin for **Google Antigravity** (Antigravity 2.0, Antigravity IDE, and `agy` CLI) designed to prevent context window saturation, reduce latency, and minimize LLM token consumption.

---

## 🎯 How It Works & Why It Saves Tokens

In standard agent workflows, when a high-reasoning model (e.g. Gemini Pro, Gemini Flash High) performs codebase search or mechanical code edits:
1. **Context Window Flooding**: Reading multiple 500–2,000 line source files directly into the primary agent context adds thousands of tokens that persist across the entire conversation history. Every subsequent prompt in that session must re-process those tokens.
2. **Excessive Reasoning Costs**: Generating complex chain-of-thought traces and verbose prose for simple repetitive edits (such as updating docstrings, formatting, or renaming variables) expends expensive reasoning tokens.

### The Delegation Solution

This plugin introduces a hierarchical delegation pattern:
- **`code-searcher`** (`flash_lite`, Read-only): Searches files, greps patterns, and inspects definitions in an **isolated subagent context**. Only a concise 2–5 line excerpt with file paths and line numbers is returned to the primary session. The raw source files never enter the primary conversation context.
- **`fast-editor`** (`flash_lite` / `flash`, Write-enabled): Performs mechanical edits, boilerplate expansions, and localized docstring updates with low reasoning overhead and zero conversational filler.
- **Primary Agent** (Primary Model): Remains focused purely on system architecture, multi-file synthesis, complex debugging, and user interaction.

### Token Economic Trade-offs

| Scenario | Direct Execution (Without Plugin) | Delegated Subagent (With Plugin) | Net Token Impact |
| :--- | :--- | :--- | :--- |
| **Grep / Search across 10 files** | Reads 5,000–15,000 tokens into primary context, paying on every future turn | Subagent reads in isolated context; returns ~150 tokens to parent | **~90–98% token reduction** over session life |
| **Mechanical Edits (3 boilerplate files)** | High-reasoning model outputs extensive thinking + verbose commentary | `flash_lite` model executes direct edits with ~80% fewer reasoning tokens | **~60–85% token & cost savings** |
| **Single 1–2 line edit in known file** | Direct `edit_file` takes ~50–100 tokens | Subagent definition + invocation overhead takes ~300–600 tokens | ⚠️ **Negative return** (Plugin rules advise direct editing here) |

---

## 📁 Repository Structure

```text
subagent-efficiency/
├── plugin.json                    # Plugin manifest
├── hooks.json                     # SessionStart lifecycle hook
├── rules/
│   └── AGENTS.md                  # Strict delegation rules & anti-patterns
├── skills/
│   └── subagent-efficiency/
│       └── SKILL.md               # Subagent schemas & invocation templates
├── scripts/
│   └── session-start.js           # SessionStart hook runner (exits 0 with injectSteps)
├── .gitignore
└── README.md
```

---

## 🚀 Installation via `agy` CLI

### Option A: Install from Local Directory
Clone or navigate to the directory and run:

```bash
agy plugin install /path/to/subagent-efficiency
```

### Option B: Install from Git Remote
Install directly from GitHub:

```bash
agy plugin install https://github.com/Yousef-Hegazy/agy-token-efficiency.git
```

---

## 🔍 Validation & Management

### Validate Plugin Integrity
```bash
agy plugin validate /path/to/subagent-efficiency
```

### List Installed Plugins
```bash
agy plugin list
```

### Enable / Disable Plugin
```bash
agy plugin enable subagent-efficiency
agy plugin disable subagent-efficiency
```

### Uninstall Plugin
```bash
agy plugin uninstall subagent-efficiency
```

---

## 🛠️ Testing the Hook Locally

To test the `SessionStart` hook standalone:

```bash
node ./scripts/session-start.js
```

Expected output:
```json
{"injectSteps":[{"systemMessage":{"systemMessage":"[Token-Efficiency Protocol Active]..."}}]}
```
