# Token-Efficiency Subagents: Delegation Rules

To conserve token budget, minimize context window saturation, and reduce latency across Antigravity 2.0, Antigravity IDE, and CLI sessions, the agent MUST enforce hierarchical delegation for codebase search and mechanical code editing tasks.

---

## 1. Subagent Specifications

### A. Code Searcher (`code-searcher`)
- **Model**: `flash_lite` (ultra-low reasoning, fast, minimal token cost)
- **Permissions**: Read-only (`EnableWriteTools: false`, `EnableMCPTools: false`, `EnableSubagentTools: false`)
- **System Prompt**: Ultra-fast codebase searcher that returns file paths, exact line numbers, and brief (2-5 line) code excerpts. Never dumps full files into parent context.
- **Role**: Codebase Searcher

### B. Fast Code Editor (`fast-editor`)
- **Model**: `flash_lite` (or `flash` for moderate multi-line edits)
- **Permissions**: Write-enabled (`EnableWriteTools: true`, `EnableMCPTools: false`, `EnableSubagentTools: false`)
- **System Prompt**: Direct code modifier using `edit_file` / `write_file`. No conversational filler or verbose chain-of-thought explanations. Directly applies changes and reports concise summaries.
- **Role**: Fast Code Editor

---

## 2. Delegation Decision Matrix

| Task Category | Threshold | Responsible Agent | Model |
| :--- | :--- | :--- | :--- |
| **Code / File Search** | Any search across files, finding symbols, regex/grep, scanning project hierarchy | `code-searcher` | `flash_lite` |
| **Small / Medium Edits** | 1–3 files, localized changes (<100 lines/file), docstrings, type hints, typo fixes, repetitive edits | `fast-editor` | `flash_lite` |
| **Moderate Refactoring** | Multi-function updates or boilerplate expansion with established patterns | `fast-editor` | `flash` |
| **Deep Reasoning & Architecture** | System design, complex multi-file planning, high-ambiguity bugs, complex algorithms | Primary Agent | Primary Model |
| **User Interaction** | Final responses, explanations, synthesizing findings for the user | Primary Agent | Primary Model |

---

## 3. Strict Rules & Anti-Patterns

1. **DO NOT read entire files into the primary context to search for symbols.**
   - *Violation*: Primary agent running `read_file` on multiple files just to locate a function definition or grep for a variable.
   - *Correct Action*: Delegate to `code-searcher`. The subagent inspects files in an isolated context and returns only the file path, line numbers, and short snippet.

2. **DO NOT perform mechanical edits with high-effort reasoning models.**
   - *Violation*: The primary agent (running on a high-tier/high-reasoning model) generating massive code blocks for localized edits or docstrings.
   - *Correct Action*: Delegate to `fast-editor` with `Model: 'flash_lite'` and exact diff instructions.

3. **Subagent Auto-Registration**:
   - If `code-searcher` or `fast-editor` have not been defined in the current session, the agent MUST define them using `define_subagent` upon first need, or invoke the built-in `research` (`Model: 'flash_lite'`) and `self` (`Model: 'flash_lite'`).

4. **Preserve Context Separation**:
   - When calling `invoke_subagent`, provide targeted instructions and the relevant file path or query.
   - The subagent must return only the synthesized outcome or change confirmation back to the parent.
