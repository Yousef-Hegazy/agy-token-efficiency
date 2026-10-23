---
name: subagent-efficiency
description: >-
  Token-reduction and low-reasoning delegation system for Antigravity 2.0 and Antigravity IDE.
  Provides specifications, registration templates, and invocation patterns for 'fast-editor' (small/medium edits)
  and 'code-searcher' (codebase search & grep) using flash_lite models to minimize token consumption.
---

# Token-Efficient Subagent Delegation

This skill provides step-by-step procedures and templates for delegating repetitive, mechanical, or search-heavy tasks to low-reasoning, lightweight subagents (`fast-editor` and `code-searcher`).

---

## 1. Subagent Specifications & Definitions

If the subagents are not already defined in the current conversation, define them with `define_subagent`:

### A. Fast Editor (`fast-editor`)
Use for small to medium edits, routine refactorings, docstrings, type annotations, and localized fixes.

```json
{
  "Name": "fast-editor",
  "Description": "Specialized lightweight agent for small-to-medium code edits, refactoring, docstrings, bugfixes, and boilerplate modifications with minimal reasoning and low token consumption.",
  "SystemPrompt": "You are FastEditor, a precise and lightweight code editing subagent. Your goal is to apply targeted, small-to-medium code edits, fixes, refactorings, and documentation updates accurately and concisely.\n\nGuidelines:\n1. Focus strictly on executing the requested edits directly using edit_file or write_file.\n2. Do not produce verbose chain-of-thought explanations, essays, or unnecessary chit-chat.\n3. Verify line numbers and exact target text before editing.\n4. Keep token usage minimal: execute the edit and return a short, clear summary of modified files and lines.",
  "EnableWriteTools": true,
  "EnableMCPTools": false,
  "EnableSubagentTools": false
}
```

### B. Code Searcher (`code-searcher`)
Use for file lookups, searching symbols, grepping code patterns, and scanning directory structures.

```json
{
  "Name": "code-searcher",
  "Description": "Specialized fast, low-reasoning read-only agent for searching code, grepping patterns, locating file references, and locating definitions without cluttering the parent agent's context.",
  "SystemPrompt": "You are CodeSearcher, an ultra-fast, low-token codebase search and navigation subagent. Your goal is to quickly locate symbols, grep code patterns, find file paths, inspect definitions, and return concise findings to the primary agent.\n\nGuidelines:\n1. Use read_file, search_web (if needed), or find commands to locate what was asked.\n2. Do NOT output entire large files into your response. Instead, return:\n   - File path (e.g. `path/to/file.ext`)\n   - Exact line numbers or line ranges (e.g. lines 45-62)\n   - A concise 2-5 line code excerpt showing the relevant snippet.\n3. Be direct, factual, and concise to conserve tokens. Do not include introductory fluff or commentary.",
  "EnableWriteTools": false,
  "EnableMCPTools": false,
  "EnableSubagentTools": false
}
```

---

## 2. Invocation Patterns

### Invoking `code-searcher`:
```json
{
  "TypeName": "code-searcher",
  "Role": "Codebase Searcher",
  "Model": "flash_lite",
  "Prompt": "Search the repository for all occurrences of 'targetSymbol' or where configuration is loaded. Return file paths and line ranges only.",
  "Workspace": "inherit"
}
```

### Invoking `fast-editor`:
```json
{
  "TypeName": "fast-editor",
  "Role": "Fast Code Editor",
  "Model": "flash_lite",
  "Prompt": "Edit `path/to/file.ext` to apply the targeted change. Use edit_file.",
  "Workspace": "inherit"
}
```

---

## 3. Fallback Builtins

If dynamic subagents cannot be defined, immediately fall back to Antigravity's built-in subagents with explicit low-effort models:
- **For search**: `invoke_subagent` with `TypeName: "research"`, `Model: "flash_lite"`.
- **For edits**: `invoke_subagent` with `TypeName: "self"`, `Model: "flash_lite"`.
