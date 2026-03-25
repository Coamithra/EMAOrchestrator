# Spike #003: CLI Interaction Model

**Date:** 2026-03-25
**Status:** Decision made
**Card:** [#003](https://trello.com/c/dS18Ol0x)

---

## Context

The EMAOrchestrator needs to communicate with Claude Code as a subprocess. Each agent (one per Trello card) runs in its own git worktree, and the orchestrator must:

1. Send step-specific prompts to Claude Code
2. Receive structured responses (text, tool calls, errors)
3. Detect and handle permission requests programmatically
4. Display real-time output to the user in a terminal-like view
5. Detect step completion and advance automatically

This is the highest-risk technical question in the project — the choice constrains the CLI driver (#005), agent detail view (#018), and permission UI (#019).

---

## Options Evaluated

### Option A: `--output-format stream-json` (raw pipes)

Spawn Claude Code with `child_process.spawn()` using `--print --output-format stream-json`. Communication is NDJSON over stdin/stdout.

**Event schema (6 top-level types):**

| Type | Purpose |
|------|---------|
| `system` | Session init (`init` subtype) and API retries (`api_retry`) |
| `assistant` | Complete assistant response with `text` and `tool_use` content blocks |
| `user` | Tool results returned to Claude |
| `result` | Final message: `success`, `error_max_turns`, `error_max_budget_usd`, `error_during_execution` |
| `stream_event` | Token-level deltas (requires `--include-partial-messages`) |
| `control_request` | Permission prompt (requires `--permission-prompt-tool stdio`) |

**Multi-turn:** Keep stdin open with `--input-format stream-json`, write NDJSON user messages between turns.

**Permissions:** Use `--permission-prompt-tool stdio`. CLI emits `control_request` on stdout; orchestrator writes `control_response` on stdin with `allow`/`deny`.

**Pros:**
- Structured, typed events — no regex or ANSI parsing
- Reliable permission detection via `control_request`/`control_response`
- No native dependencies
- Multi-turn via stdin NDJSON

**Cons:**
- No raw terminal output for xterm.js — must build a custom renderer
- Requires `--print` mode (no interactive TUI features)
- `--input-format stream-json` is poorly documented (reverse-engineered from SDK source)
- Must handle NDJSON parsing, reconnection, and error recovery manually

### Option B: PTY (node-pty)

Spawn Claude Code in a pseudo-terminal via `node-pty`. Display raw output in xterm.js.

**Pros:**
- xterm.js renders output faithfully (colors, formatting, TUI elements)
- Native terminal experience

**Cons:**
- **Permission detection is fragile** — Claude Code renders permissions using Ink/React TUI with ANSI cursor positioning. No machine-readable markers exist. Parsing this is reverse-engineering the TUI output.
- **Step completion detection is fragile** — same ANSI parsing problem
- Native module (node-pty) requires rebuild against Electron's Node ABI
- Windows ConPTY has known issues: lingering conhost processes, ANSI shift on first output
- Cannot programmatically orchestrate — would need to simulate keystrokes

### Option C: Dual Channel (PTY + stream-json)

Run both a PTY for display and stream-json for orchestration from the same Claude process.

**Result: Not feasible.** PTY requires Claude Code's interactive mode; stream-json requires `--print` mode. These are mutually exclusive. You cannot get structured JSON output from an interactive PTY session.

### Option D: Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

Use Anthropic's official TypeScript SDK, which internally spawns Claude Code with stream-json and provides a typed API.

**Pros:**
- Typed `StreamEvent` objects in TypeScript
- `canUseTool` callback for permission handling — no parsing needed
- `AskUserQuestion` arrives as a tool-use event in the message stream (not a dedicated callback)
- Multi-turn via streaming input mode
- Zero native dependencies
- Official, maintained by Anthropic

**Cons:**
- ~12s cold start per `query()` call (~2-3s warm follow-ups)
- SDK documentation has gaps (closed as NOT_PLANNED: issues #24594, #24596)
- Adds a dependency layer between us and the CLI
- No raw terminal output — same custom renderer requirement as Option A

---

## Decision: Option D (Agent SDK) + Synthetic Terminal Display

**Chosen approach:** Use `@anthropic-ai/claude-agent-sdk` for all orchestration logic, with xterm.js fed by `StreamEvent` text deltas for the visual display.

### Architecture

```
┌─────────────────────────────────────────────────┐
│ Electron Main Process                           │
│                                                 │
│  ┌──────────────┐    ┌───────────────────────┐  │
│  │ Orchestrator  │───>│ Agent SDK query()     │  │
│  │ (step logic)  │<───│  - canUseTool cb      │  │
│  │               │    │  - StreamEvent stream  │  │
│  └──────┬───────┘    └───────────────────────┘  │
│         │ IPC                                    │
├─────────┼───────────────────────────────────────┤
│ Electron Renderer                               │
│         │                                       │
│  ┌──────▼───────┐    ┌───────────────────────┐  │
│  │ Agent Detail  │───>│ xterm.js Terminal     │  │
│  │ View (#018)   │    │ (fed by StreamEvents) │  │
│  │               │    └───────────────────────┘  │
│  │               │    ┌───────────────────────┐  │
│  │               │───>│ Permission UI (#019)  │  │
│  │               │    │ (from canUseTool cb)  │  │
│  └──────────────┘    └───────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### How It Works

1. **Orchestrator** calls `query()` with a step-specific prompt and config
2. **StreamEvents** flow to the renderer via IPC, where xterm.js renders text deltas as they arrive (the `query()` AsyncGenerator yields `SDKMessage` objects including `stream_event` types)
3. **Permission requests** trigger `canUseTool` callback → IPC to renderer → custom permission UI → user decision → callback response
4. **User questions** arrive as `AskUserQuestion` tool-use events in the message stream — detected and routed to the UI like permissions
5. **Step completion** detected from the `result` event's `subtype` field
6. **Multi-turn** supported via the SDK's streaming input mode

### Why Not PTY?

The PTY approach (Option B) gives a beautiful native terminal experience but makes programmatic orchestration nearly impossible. Detecting permissions and step completion from ANSI-encoded Ink/React TUI output is fragile and would break on any Claude Code update. The orchestrator's core value prop is *automated step progression* — we need structured events, not terminal scraping.

### Why SDK Over Raw stream-json?

The Agent SDK (Option D) wraps raw stream-json (Option A) with:
- Typed TypeScript interfaces instead of manual NDJSON parsing
- Built-in `canUseTool` callback instead of manual `control_request`/`control_response` handling
- Official maintenance — when the protocol changes, the SDK updates
- Battle-tested by Anthropic's own tooling

The cold-start overhead (~12s first call, ~2-3s subsequent) is acceptable since each agent runs a multi-step session lasting minutes to hours. Note: the SDK is pre-1.0 (`0.2.x`), so breaking API changes are possible — pin the version in `package.json`.

### xterm.js Role

xterm.js will render a **synthetic terminal view** — not a real PTY. We feed `stream_event` text deltas into `terminal.write()` to give users a familiar terminal-like experience. Tool calls, results, and status updates can be rendered with ANSI colors for visual clarity. This is similar to how many CI/CD UIs render build logs.

---

## Impact on Downstream Cards

### #005 CLI Driver
- Wraps `@anthropic-ai/claude-agent-sdk` `query()` function
- Manages session lifecycle (start, send prompt, handle events, stop)
- Exposes `canUseTool` and `StreamEvent` via callbacks/events

### #018 Agent Detail View
- Receives `StreamEvent` text deltas via IPC
- Renders in xterm.js as a synthetic terminal
- Shows agent metadata (step progress, status, model, cost)
- No node-pty dependency needed

### #019 Permission & Interaction UI
- Receives permission requests from `canUseTool` callback via IPC
- Renders as a custom React UI (tool name, input details, allow/deny buttons)
- Sends user decision back via IPC to resolve the callback
- Also handles `AskUserQuestion` tool-use events from the message stream (these are regular tool calls, not a dedicated callback)

---

## Key References

- [Claude Code headless mode docs](https://code.claude.com/docs/en/headless)
- [Agent SDK TypeScript docs](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Agent SDK streaming output](https://platform.claude.com/docs/en/agent-sdk/streaming-output)
- [Agent SDK permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [Agent SDK user input](https://platform.claude.com/docs/en/agent-sdk/user-input)
