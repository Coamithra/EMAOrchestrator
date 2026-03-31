# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# EMAOrchestrator

"Everybody's Making An" Orchestrator — a runbook enforcer that drives Claude Code sessions step-by-step through a CONTRIBUTING.md workflow, so the human doesn't have to babysit adherence.

## Links

- **Trello Board:** https://trello.com/b/MibMpIB8/emaorchestrator

## Tech Stack

- Electron + React + TypeScript (desktop app)
- `@anthropic-ai/claude-agent-sdk` (spawns Claude CLI, provides typed events and permission callbacks)
- Block-based React chat terminal (renders SDK events as styled React components — markdown, code highlighting, collapsible tool panels)

### CLI Interaction Model (Spike #003)

**Decision:** Use the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) for all CLI interaction. The SDK's `query()` returns an AsyncGenerator yielding typed `SDKMessage` objects. Permissions are handled via `canUseTool` callback; `AskUserQuestion` arrives as a tool-use event in the message stream. xterm.js renders a synthetic terminal fed by `stream_event` text deltas — no node-pty or real PTY needed.

**Why not PTY?** Detecting permissions and step completion from ANSI-encoded Ink/React TUI output is fragile and breaks on Claude Code updates. The orchestrator needs structured events, not terminal scraping.

**Full decision doc:** `docs/spike-003-cli-interaction-model.md`

### Context Strategy for Multi-Step Prompts (Spike #009)

**Decision:** Use a single long-lived SDK session per agent. Each runbook step is sent as a new prompt within the same conversation — prior-step context is already in Claude's memory. No manual context injection, summarization, or sliding window needed. The SDK's built-in auto-compaction handles the edge case where context approaches the 1M token limit.

**Why not inject context?** With 1M native context on Claude 4.6 (required model family) and SDK auto-compaction as a safety net, manually managing context is unnecessary complexity. A 29-step runbook fits comfortably (~670K tokens including prompts, outputs, and generation room).

**Full decision doc:** `docs/spike-009-context-strategy.md`

## Architecture

Central controller pattern: orchestrator parses the runbook into discrete steps, spawns one Claude CLI session per Trello card (each in its own git worktree), feeds step-specific prompts, detects completion, and advances automatically.

### CLI Driver (`src/main/cli-driver.ts`)

Wraps the Agent SDK's `query()` into an EventEmitter-based service. One `CliDriver` instance per agent session. Key design:

- **Permission pause/resume:** `canUseTool` callback creates a deferred Promise that blocks the SDK generator until `respondToPermission()` is called. This bridges the async callback to the Electron IPC/UI flow. The orchestration loop passes `settingSources: ['user', 'project', 'local']` so the SDK loads permission rules from `~/.claude/settings.json`, `.claude/settings.json`, and `.claude/settings.local.json` — tools already allowed by those settings are auto-approved without hitting the UI dialog. Including `'project'` also loads CLAUDE.md project instructions into agent sessions.
- **Smart auto-approval:** The `canUseTool` callback respects `CliSessionOptions.approvalMode`: `'always'` auto-approves all requests, `'smart'` calls the smart approval evaluator (LLM-based) and auto-approves on `'yes'`, emits a `security:alert` event on `'no'` (halts the agent and shows a red security alert dialog with the LLM's explanation), falls through to manual permission dialog on `'maybe'`/error, `'never'` (default) always shows the UI dialog. Auto-approved decisions emit styled `stream:text` messages for terminal visibility.
- **Security alerts:** On smart approval `'no'` decisions, the driver creates a deferred promise (same pattern as permissions), emits `security:alert` with the `SecurityAlertRequest` (includes the LLM's explanation), and blocks until `respondToSecurityAlert()` is called. The response is either `'override'` (allows the tool call) or `'dismiss'` (denies and stops the agent).
- **AskUserQuestion:** Detected as `tool_use` blocks with `name === 'AskUserQuestion'` in `SDKAssistantMessage`. Response sent via `query.streamInput()`.
- **Session resumption:** Pass a previous `sessionId` to `CliSessionOptions` to resume a conversation.
- **Streaming output:** `includePartialMessages: true` is required in the SDK query options to receive `stream_event` messages (typed as `SDKPartialAssistantMessage`). Without it, only full `assistant` messages are yielded and the terminal stays blank.
- **Claude CLI resolution:** The SDK's built-in `cli.js` path resolution can fail in Electron contexts. The driver explicitly resolves the system `claude` binary via `where`/`which` at module load and passes it as `pathToClaudeCodeExecutable`.
- **Newline handling:** A `\n` is emitted before each `content_block_start` (text type) so successive text segments separated by tool calls don't run together in the terminal.
- **Tool events:** `tool_progress` SDK messages emit `tool:activity` (tool name + elapsed seconds). `tool_use_summary` SDK messages emit `tool:summary` (summary text). Tool use blocks in `assistant` messages emit `tool:start` (tool name + input summary via `summarizeToolInput()`). These events are forwarded through the IPC `CliEvent` union to the renderer.
- **Shared types:** `src/shared/cli-driver.ts` defines all event/state types for use across main process and renderer.

### Trello Service (`src/main/trello-service.ts`)

Stateless exported functions for Trello REST API operations. Uses native `fetch()` with 10-second timeouts. Read functions degrade gracefully (return empty arrays on failure, never throw). Mutation functions (`moveCard`, `addComment`) retry up to 3 times with exponential backoff (1s, 2s delays) on network errors and 5xx server errors; 4xx client errors are not retried.

- **`getListsForBoard(boardId, creds)`** — Fetches all open lists for a board.
- **`getListIdByName(boardId, listName, creds)`** — Resolves a list name to its ID (case-insensitive). Retained for potential external use but no longer called by the orchestrator (list IDs are stored directly in config).
- **`getCardsFromList(listId, creds)`** — Fetches all open cards from a list.
- **`moveCard(cardId, targetListId, creds)`** — Moves a card to a different list (PUT).
- **`addComment(cardId, text, creds)`** — Posts a comment on a card (POST).
- **`moveCardToSourceList(cardId, sourceListId, backlogListIds, creds)`** — Moves a card back to its source list. Falls back to the first backlog list if `sourceListId` is empty/undefined (backward compat for pre-existing agents). Fire-and-forget safe.
- **Shared types:** `src/shared/trello.ts` defines `TrelloCredentials`, `TrelloList`, `TrelloCard`. `TrelloCard.sourceListId` (optional) is set by the backlog card fetcher to track which list a card was sourced from.
- **Orchestration integration:** The orchestration loop uses `config.trelloListIds` directly (no runtime name→ID resolution). Calls `moveCard` (to In Progress on start, to Done on completion) and `addComment` (summary on completion) as fire-and-forget operations that never block agent work.
- **Card cleanup:** When an agent is dismissed or detected as stale on startup, `moveCardToSourceList` returns the Trello card to its original list. The source list is tracked via `CardInfo.sourceListId`, threaded from the backlog card fetch through agent creation to persistence.
- **IPC channels:** `trello:getLists`, `trello:getListsForBoard`, `trello:getBacklogCards` — for the renderer to fetch board data. `getListsForBoard` accepts explicit credentials (used by Settings to fetch lists before saving).

### Worktree Manager (`src/main/worktree-manager.ts`)

Wraps `git worktree` commands into an async service. Stateless exported functions (same pattern as config-service). One worktree per agent session, created as siblings to the main repo directory.

- **`createWorktree(repoPath, branch, basePath?, defaultBranch?)`** — Creates worktree + new branch from the specified or auto-detected default branch (`git symbolic-ref`, falls back to `main`). Reuses branch if it already exists. Optional `basePath` overrides the default sibling-to-repo location. Optional `defaultBranch` overrides auto-detection.
- **`listRemoteBranches(repoPath)`** — Lists remote branch names from origin via `git ls-remote --heads origin`. Used by the Settings UI to populate the default branch dropdown.
- **`listWorktrees(repoPath)`** — Parses `git worktree list --porcelain` into typed `WorktreeInfo[]`.
- **`removeWorktree(repoPath, worktree)`** — Removes worktree by `WorktreeInfo`, prunes, deletes branch.
- **`getOrphanedWorktrees(repoPath)`** — Returns all non-main worktrees (orphans on startup).
- **`cleanupOrphanedWorktrees(repoPath)`** — Removes all orphans and their branches.
- **Shared types:** `src/shared/worktree.ts` defines `WorktreeInfo` for use across main and renderer.

### Smart Runbook Parser (`src/main/smart-runbook-parser.ts`)

AI-powered alternative to the regex runbook parser. Uses the Agent SDK's `query()` to send the raw markdown to Claude with a system prompt instructing it to return structured JSON matching the `Runbook` schema.

- **`parseRunbookSmart(markdown)`** — Sends markdown to Claude, extracts JSON from the response, validates and normalizes it into a `Runbook`. Uses `maxTurns: 1` with all tools denied (pure text generation).
- **JSON extraction:** Handles both raw JSON and markdown-fenced JSON responses.
- **Validation:** Normalizes `phase` and `index` fields on each step to match parent phase. Throws on missing required fields or empty phases/steps.
- **Fallback:** The integration in `ipc-handlers.ts` catches errors and falls back to the regex parser if the smart parser fails.

### Smart Approval Service (`src/main/smart-approval-service.ts`)

LLM-powered permission evaluator. Uses the Agent SDK's `query()` (same pattern as the smart runbook parser) with `maxTurns: 1`, no tools, and a safety-focused system prompt.

- **`evaluatePermission(ctx)`** — Takes tool name, input, worktree path, and current step title. Returns an `EvaluationResult` with `decision` (`'yes'`/`'no'`/`'maybe'`) and optional `explanation` (present on `'no'` decisions — the LLM's reasoning for why the operation is dangerous). 15-second timeout. Returns `{ decision: 'maybe' }` on any error (safe fallback to manual review).
- **System prompt:** Rules covering read-only ops (safe), in-worktree edits (safe), build/test commands (safe), destructive ops (unsafe), out-of-bounds writes (unsafe), shell redirects (unsafe), special-source overwrites (unsafe), shell obfuscation techniques (unsafe). Includes anti-prompt-injection instruction to ignore embedded comments/instructions. On `'no'` decisions, the LLM also provides an `explanation` field.
- **Integration:** Called by `CliDriver.createCanUseToolCallback()` when `approvalMode === 'smart'`. Only invoked for tools that the SDK's `settingSources` didn't already auto-approve. On `'no'` decisions, the driver emits a `security:alert` event (halting the agent) instead of falling through to the manual permission dialog. On `'maybe'`, the normal permission dialog is shown.

### Permission Settings Service (`src/main/permission-settings-service.ts`)

Persists tool permission patterns to `.claude/settings.local.json` in the target repo. Stateless exported functions (same pattern as config-service). Enables the "Always Allow" button in the PermissionDialog — writes a pattern so the SDK auto-approves matching tool calls in future sessions.

- **`generateToolPattern(toolName, toolInput)`** — Converts a permission request into a Claude CLI-compatible pattern string. Non-Bash tools return the tool name (e.g., `"Write"`). Bash tools extract a command prefix (max 2 words) and return `"Bash(prefix:*)"` (e.g., `"Bash(git add:*)"`, `"Bash(npm run:*)"`, `"Bash(ls:*)"`)
- **`addAllowedToolPattern(repoPath, pattern)`** — Reads `<repoPath>/.claude/settings.local.json`, adds the pattern to `permissions.allow` (creates file/dir if needed), writes back. No-op if the pattern already exists or repoPath is empty. Fire-and-forget safe.
- **Integration:** Called from `OrchestrationLoop.respondToPermission()` when `response.rememberChoice === true`. The write is fire-and-forget — it never blocks the permission response flow.

### Runbook Cache (`src/main/runbook-cache.ts`)

Content-hash cache for parsed runbooks. Stateless exported functions (same pattern as config-service). Stored at `app.getPath('userData')/runbook-cache/`.

- **`getCachedRunbook(markdown, parserType)`** — Returns cached `Runbook` if the content hash matches, `null` on miss.
- **`cacheRunbook(markdown, parserType, runbook)`** — Stores a parsed runbook. Fire-and-forget safe.
- **Cache key:** SHA-256 of `parserType:markdown`. Same content with different parser types produces different cache entries.
- **Integration:** Called by `resolveRunbook()` in `ipc-handlers.ts` before and after parsing.

### Step Prompt Generator (`src/main/prompt-generator.ts`)

Pure function that transforms a parsed `RunbookStep` + card context into a Claude prompt string. Called by the orchestration loop to generate the prompt for each step.

- **`generateStepPrompt(context)`** — Takes a `StepPromptContext` and returns a prompt string ready for `CliSessionOptions.prompt`.
- **Position header:** Each prompt starts with "Phase X of Y: PhaseName — Step Z of W" so Claude knows where it is in the workflow.
- **First-step card context:** The Trello card name, description, branch, and worktree path are included only in the very first prompt. Subsequent prompts omit this since the long-lived session already has it (per spike #009).
- **Completion signal:** Non-final steps instruct the model to call `AskUserQuestion("STEP_DONE: <summary>")` to keep the session alive (spike #010). The final step (`isLastStep: true`) asks for a plain text summary so the generator completes naturally.
- **Shared types:** `src/shared/prompt-generator.ts` defines `StepPromptContext` for use across main and renderer.

### Agent State Machine (`src/main/agent-state-machine.ts`)

Tracks a single agent's lifecycle as it works through a parsed runbook. Higher-level than the CliDriver state machine — this orchestrates progress through runbook phases and steps.

- **Dynamic states:** Constructed from the parsed `Runbook` phases. Each phase name becomes a valid state. Fixed states (`idle`, `picking_card`, `error`, `waiting_for_human`, `done`) are always present.
- **Transition enforcement:** Only valid transitions are allowed (e.g., phases must be traversed in order). Invalid transitions throw.
- **Step tracking:** `advanceStep()` marks the current step complete and advances within a phase or auto-transitions to the next phase.
- **Pause/resume:** `setWaitingForHuman()` saves the current phase/step, `resumeFromWaiting()` restores it. `resumeFromError()` transitions from error back to the errored phase without resetting step tracking (used for restart-from-last-step).
- **Events:** Emits `state:changed`, `step:advanced`, `step:completed`, `phase:completed`, `error`.
- **Shared types:** `src/shared/agent-state.ts` defines `AgentState`, `AgentStateSnapshot`, `AgentStepProgress`, and event types.

### Agent Manager (`src/main/agent-manager.ts`)

Central registry for all active agents. Ties together the Trello card, git worktree, state machine, and CLI session into a single agent concept.

- **`createAgent(card, runbook, repoPath)`** — Creates a worktree (branch derived from card name), instantiates a state machine, registers the agent. Returns the agent ID. Auto-persists.
- **`restoreAgent(persisted)`** — Restores an agent from persisted data. Reconstructs state machine via `AgentStateMachine.restore()`, reuses the original agent ID, skips worktree creation. Used on app startup.
- **`destroyAgent(agentId, repoPath)`** — Removes the worktree, disconnects event forwarding, deletes from registry. Removes persisted state.
- **`getAgent(agentId)`** / **`listAgents()`** — Returns `AgentSnapshot` objects with card info, worktree info, state machine snapshot, session ID, step history, and interruption status.
- **`getStateMachine(agentId)`** — Exposes the state machine for the orchestration loop to drive.
- **`getRunbook(agentId)`** — Exposes the runbook for the orchestration loop to look up steps.
- **`setSessionId(agentId, sessionId)`** — Links/unlinks a CLI session to an agent.
- **`setStepSummary(agentId, phaseIndex, stepIndex, summary)`** — Sets a summary on a completed step record. Called by the orchestration loop.
- **`setPendingHumanInteraction(agentId, interaction)`** — Sets or clears the pending human interaction. Called by the orchestration loop.
- **Event forwarding:** State machine events are re-emitted as agent-level events (`agent:created`, `agent:state-changed`, `agent:step-advanced`, `agent:step-completed`, `agent:phase-completed`, `agent:error`, `agent:done`, `agent:destroyed`). Step completions also record history entries.
- **Shared types:** `src/shared/agent-manager.ts` defines `CardInfo`, `AgentSnapshot`, and `AgentManagerEvents`.

### Agent Persistence Service (`src/main/agent-persistence-service.ts`)

Persists agent state to `app.getPath('userData')/agents.json` so agents survive app restarts. Follows the config-service pattern (stateless exported functions, JSON, null on error).

- **`loadPersistedAgents()`** — Reads and parses the agents file. Returns `null` on missing file, corrupt JSON, or version mismatch.
- **`savePersistedAgents(store)`** — Writes the full store as pretty-printed JSON.
- **`saveAgent(agent)`** — Upserts a single agent (read-modify-write; safe in single-threaded main process).
- **`removePersistedAgent(agentId)`** — Removes an agent entry from the store.
- **`reconcileAgents(store)`** — On startup, checks each persisted agent's worktree. Missing worktree → stale. Was mid-run → interrupted (sets `interruptedAt`). Otherwise → restored.
- **State machine restore:** `AgentStateMachine.restore(runbook, data)` reconstructs a machine from persisted `StateMachineRestoreData` without emitting events. The runbook is persisted alongside each agent.
- **Save triggers:** `AgentManager` auto-saves on every `state:changed` and `step:completed` event (fire-and-forget).
- **Shared types:** `src/shared/agent-persistence.ts` defines `PersistedAgent`, `PersistedAgentStore`, `StepCompletionRecord`, `PendingHumanInteraction`, `ReconciliationResult`.

### Tracker Doc Service (`src/main/tracker-doc-service.ts`)

Generates and maintains the `docs/tracker_<branch>.md` file in each agent's worktree, satisfying the CONTRIBUTING.md "Before You Start" requirement. Stateless exported functions (same pattern as config-service).

- **`createTrackerDoc(worktreePath, branch, runbook)`** — Generates a markdown file with all runbook phases and steps as unchecked checkboxes. Creates the `docs/` directory if needed.
- **`checkOffStep(worktreePath, branch, phaseIndex, stepIndex)`** — Reads the tracker file, checks off the specified step (`- [ ]` → `- [x]`). No-op if the file doesn't exist.
- **`removeTrackerDoc(worktreePath, branch)`** — Deletes the tracker file. No-op if already gone.
- **`trackerDocPath(worktreePath, branch)`** — Returns the file path. Replaces `/` in branch names with `_` for flat filenames.
- **`generateTrackerContent(branch, runbook)`** — Pure function that returns the markdown string (testable without I/O).
- **Integration:** The orchestration loop calls `createTrackerDoc` on agent start, `checkOffStep` after each step completes, and `removeTrackerDoc` when the agent finishes. All calls are fire-and-forget (never block orchestration).

### Logging Service (`src/main/logging-service.ts`)

Per-agent structured logging to JSONL files. Stateless exported functions (same pattern as config-service). Logs stored at `app.getPath('userData')/logs/<agentId>.jsonl`.

- **`appendLogEntry(entry)`** — Appends a JSON line to an agent's log file. Creates the logs directory on first write. Fire-and-forget safe (catches and console.errors on failure).
- **`readAgentLog(agentId)`** — Reads and parses all log entries for an agent. Returns empty array on missing/unreadable file.
- **`getLogPath(agentId)`** — Returns the file path for an agent's log.
- **Log entry types:** `agent_started`, `prompt_sent`, `response_received`, `step_completed`, `step_error`, `permission_requested`, `question_asked`, `agent_completed`, `agent_error`, `agent_stopped`. All entries include timestamp, agentId, cardName.
- **Integration:** The orchestration loop calls `appendLogEntry()` at each lifecycle point (step start/end, errors, permissions, questions). Logging never blocks orchestration.
- **Shared types:** `src/shared/logging.ts` defines `LogEntry` (discriminated union) and all entry-specific interfaces.
- **IPC channel:** `logging:getLog` — renderer can fetch an agent's full log via `window.api.getAgentLog(agentId)`.

### Session Registry (`src/main/session-registry.ts`)

Manages active CliDriver instances and bridges their events to the renderer. One registry for the app.

- **`createSession(options)`** — Creates a CliDriver, wires event forwarding, starts the session. Returns a UUID session ID immediately; the session runs async.
- **`getSession(sessionId)`** — Retrieves a CliDriver by ID (for responding to permissions/questions).
- **`abortAllSessions()`** — Aborts all active sessions (called on app quit).
- **Event forwarding:** All CliDriver events are pushed to the renderer via `webContents.send('cli:event', payload)`. Payload shape: `{ sessionId, event: CliEvent }` (discriminated union).
- Sessions auto-remove from the registry on completion or error.

### Orchestration Loop (`src/main/orchestration-loop.ts`)

Central controller that drives agents through runbook steps. One async loop per agent runs concurrently. Ties together AgentManager, AgentStateMachine, CliDriver, and PromptGenerator.

- **Concurrency management:** Enforces a configurable max concurrent agents limit (from `AppConfig.maxConcurrentAgents`, default 3). When the limit is reached, new agents are queued and auto-start when a slot opens (agent completes, errors, or is stopped). Queueing is tracked in the loop, not in the agent state machine.
- **`startAgent(agentId)`** — Starts the loop for an agent, or queues it if the concurrency limit is reached. Handles any starting state (idle, error, waiting_for_human, mid-phase).
- **`stopAgent(agentId)`** — Removes from queue (if queued) or aborts the active CLI session (if running). Triggers dequeue.
- **`respondToPermission(agentId, response)`** — Unblocks the CliDriver's pending permission and resumes the state machine from waiting_for_human.
- **`respondToQuestion(agentId, response)`** — Unblocks the CliDriver's pending question and resumes the state machine.
- **`isRunning(agentId)`** — Returns true if the agent is running OR queued.
- **`isQueued(agentId)`** — Returns true only if the agent is waiting in the queue.
- **`getConcurrencyStatus()`** — Returns `{ running, queued, max }` snapshot for the UI.
- **`setMaxConcurrentAgents(max)`** — Live-updates the limit. Does not kill running agents; dequeues if the new limit is higher.
- **`abortAll()`** — Clears the queue and aborts all running agents. Called on app quit.
- **Step execution:** Each step creates a fresh CliDriver, generates a prompt via `generateStepPrompt()`, runs the session, extracts a summary from the last assistant message, calls `advanceStep()` (which auto-transitions phases), then sets the summary. The CLI session's `cwd` is set to `config.targetRepoPath` (the project root) so the SDK finds `.claude/settings.*` for permission rules — the worktree path is communicated to the agent via the step prompt.
- **Continuous session (spike #010):** All steps run in a single `query()` call — no `--resume` between steps. Non-final steps signal completion via `AskUserQuestion("STEP_DONE: <summary>")`. The orchestrator detects the `STEP_DONE:` prefix, advances the state machine, and auto-responds with the next step's prompt via `streamInput()`. The final step ends naturally (no `AskUserQuestion`). Real human questions (no prefix) still show the UI dialog. This eliminates the 28 `--resume` calls per 29-step runbook that previously invalidated prompt cache at 1.25x cost. On restart after stop/error, one `resume` reconnects to the prior session.
- **Permission/question flow:** CliDriver blocks internally (deferred promise). The loop sets `waiting_for_human` on the state machine and stores the pending interaction. When the user responds via IPC, the driver unblocks and the session continues. The `runStep()` Promise stays pending during pauses — no polling needed.
- **Error recovery:** When an agent errors and is restarted, `resumeFromError()` preserves the phase/step position so the agent resumes from the failed step, not the beginning of the phase.
- **Stuck-agent watchdog:** A periodic check (every 60s) detects agents with no CLI activity for the configured timeout (`stuckAgentTimeoutMinutes`, default 10). Emits `agent:stuck` event. Paused during `waiting_for_human` state. Activity resets on any `stream:text`, `assistant:message`, or `session:init` event.
- **Events:** Emits `agent:running`, `agent:queued`, `agent:dequeued`, `agent:completed`, `agent:errored`, `agent:stopped`, `agent:stuck`.
- **Renderer forwarding:** All CliDriver events are forwarded to the renderer via `cli:event` channel using session ID `orchestration-<agentId>`.
- **Shared types:** `src/shared/orchestration-loop.ts` defines `OrchestrationLoopEvents` and `ConcurrencyStatus`.
- **Direct prompt:** `sendDirectPrompt(agentId, prompt)` lets the user bypass runbook execution and send an arbitrary prompt to an agent. If the agent is currently running a step, it is stopped first. The prompt is sent as a standalone CLI session using the agent's existing SDK session ID (preserving conversation context). After completion, the agent stays in its current phase state — Resume continues the runbook. The new session ID is captured so future steps resume the same conversation. Output is wired to the renderer via the same `orchestration-<agentId>` channel.
- **IPC channels:** `orchestration:start`, `orchestration:stop`, `orchestration:respondPermission`, `orchestration:respondQuestion`, `orchestration:isRunning`, `orchestration:getConcurrencyStatus`, `orchestration:sendDirectPrompt`.

### IPC Bridge (`src/shared/ipc.ts`)

Central definition of all IPC channel constants and the renderer API type.

- **`IpcChannels`** — String constants for all channels (config, dialog, CLI, worktree, agent persistence, orchestration). Prevents typos and provides a single source of truth.
- **`CliEvent`** — Discriminated union of all CLI events pushed from main to renderer.
- **`CliEventPayload`** — Wrapper with `sessionId` + `CliEvent` for the `cli:event` channel.
- **`AgentAPI`** — TypeScript interface for the CLI/worktree portion of the preload API.
- **`AgentCreateAPI`** — TypeScript interface for agent creation from the renderer (`createAgent(card)`).
- **`OrchestrationAPI`** — TypeScript interface for the orchestration loop portion of the preload API.

### Agent Detail Panel (`src/renderer/src/components/AgentDetailPanel.tsx`)

Main panel for viewing a selected agent's state and output. Composes two sub-components:

- **`ChatTerminal`** (`src/renderer/src/components/ChatTerminal.tsx`) — Block-based React terminal that renders SDK events as styled components instead of raw ANSI in xterm.js. On mount, replays blocks from the message stream service, then subscribes for live updates. Auto-scrolls to bottom on new content, with scroll-lock on manual scroll-up and a "Jump to bottom" button.
  - **Message Stream Service** (`src/renderer/src/services/message-stream-service.ts`) — Singleton service initialized once at app startup (`initMessageStream()`). Subscribes globally to `cli:event` IPC channel and accumulates structured `MessageBlock[]` per agent. Uses a 30ms text accumulator for streaming markdown detection. Provides `getBlocks(agentId)` for replay, `subscribe(agentId, cb)` for live updates via `BlockUpdate` notifications (`block:appended`, `block:updated`, `blocks:reset`), and `clearBlocks(agentId)` for cleanup. Max 500 blocks per agent. **Tool block lifecycle:** `tool:activity` creates a tool block if none is active (SDK may yield `tool_progress` before the `assistant` message). `tool:start` backfills `inputSummary` on an existing empty block rather than creating a duplicate. `assistant:message` does NOT finalize tool blocks — tools are still running when the assistant message arrives; finalization happens via `tool:summary`, `stream:text`, or the next `tool:start`.
  - **Block components** (`src/renderer/src/components/blocks/`) — Each SDK event type maps to a React component: `TextBlockView` (streaming markdown via `react-markdown` + `react-syntax-highlighter` with copy buttons on code blocks), `ToolBlockView` (collapsible tool panels — Bash as `$ command`, others as `> ToolName`), `BannerBlockView` (phase/step headers), `ResultBlockView` (cost/turns/duration stats), `StatusBlockView` (auto-approve/smart-approve one-liners), `ErrorBlockView` (red error messages). All wrapped in `React.memo` for performance.
  - **Shared block types** (`src/shared/message-block.ts`) — `MessageBlock` discriminated union (`TextBlock`, `BannerBlock`, `ToolBlock`, `ResultBlock`, `StatusBlock`, `ErrorBlock`) and `BlockUpdate` notification type.
  - **Structured event types:** The orchestration loop emits `step:banner` events (structured data) instead of ANSI-encoded `stream:text`. The CLI driver emits `approval:status` events for auto-approve/smart-approve decisions instead of ANSI text. These dedicated event types eliminate ANSI from the renderer entirely.
- **`StepProgress`** (`src/renderer/src/components/StepProgress.tsx`) — Collapsible phase/step progress indicator. Shows each runbook phase with expand/collapse, and each step with status icons (pending/running/done) and completion summaries. Current active phase auto-expands. Derives state from `AgentStateSnapshot` + `StepCompletionRecord[]` + the agent's `Runbook`.
- **`PermissionDialog`** (`src/renderer/src/components/PermissionDialog.tsx`) — Modal overlay for permission requests. Extracts `command` and `description` from `toolInput` for rich formatting: description as readable text, command in a monospace block. Remaining fields shown as JSON under "Details". Falls back to "No input" for empty inputs. Three action buttons: Deny, Always Allow (persists pattern to `settings.local.json` via the permission-settings-service so the SDK auto-approves matching calls in future sessions), and Allow. Non-dismissable — cannot be closed by clicking outside or pressing Escape (prevents accidental denial that strands the agent).
- **`SecurityAlertDialog`** (`src/renderer/src/components/SecurityAlertDialog.tsx`) — Modal overlay for smart approval `'no'` decisions. Red danger theme. Shows the LLM's explanation of why the operation is dangerous, plus the tool name and input. Two actions: "Dismiss Agent" (stops the agent via `respondToOrchestrationSecurityAlert` with `behavior: 'dismiss'`) and "Override and Allow" (requires a two-click confirmation — first click shows "Are you sure?" / "Yes, Override"). Non-dismissable.
- **`QuestionDialog`** (`src/renderer/src/components/QuestionDialog.tsx`) — Modal overlay for `AskUserQuestion` tool calls. Shows the question text and a text input. Submit calls `respondToOrchestrationQuestion()` via IPC. Enter key submits (Shift+Enter for newline). Non-dismissable like PermissionDialog.
- **Permission/question/security alert event tracking:** `AgentDetailPanel` subscribes to `cli:event` (filtered by `sessionId === 'orchestration-<agentId>'`) to receive `PermissionRequest`, `SecurityAlertRequest`, and `UserQuestionRequest` data in real-time. Dialogs are also seeded from `agent.pendingHumanInteraction` on mount so they appear immediately when switching to an agent already waiting for input. Dialogs are cleared when the agent exits `waiting_for_human` state or on agent switch. Dialogs are **gated on `isRunning`** — they only render when the agent has an active CLI session that can receive responses. Non-running agents in `waiting_for_human` show the Resume button instead.
- **Header:** Card name, phase/step label, "waiting for input" badge when `pendingHumanInteraction` is set, Resume button (when agent is not running and not done), and Stop button (when running).
- **Sidebar notification:** A pulsing "!" badge appears on sidebar agent items when `stateSnapshot.state === 'waiting_for_human'`.
- **`AgentSnapshot.runbook`:** The full `Runbook` is included in `AgentSnapshot` so the renderer has phase/step names without an extra IPC call.
- **`pendingHumanInteraction` sync:** `AgentManager.setPendingHumanInteraction()` emits `agent:interaction-changed` which is forwarded to the renderer via `agent:event` IPC. `App.tsx` handles this event to keep `pendingHumanInteraction` in sync. Additionally, `App.tsx` clears `pendingHumanInteraction` to `null` on `agent:state-changed` events when the new state is not `waiting_for_human`. The `PendingHumanInteraction` type includes optional `permissionRequest` / `questionRequest` / `securityAlertRequest` fields storing the full request data for rich dialog seeding after agent switch or app reload. The `type` field has three values: `'permission'`, `'question'`, and `'security_alert'`.
- **`ConsoleInput`** (`src/renderer/src/components/ConsoleInput.tsx`) — Text input bar below the ChatTerminal for sending direct prompts to an agent. Enter submits, Shift+Enter for newline. Auto-resizes up to 120px. Calls `sendDirectPrompt(agentId, prompt)` via IPC. Disabled when agent is done or waiting for human input (permission/question dialog). Shows a sending state while the prompt is being processed.

### New Agent Dialog (`src/renderer/src/components/NewAgentDialog.tsx`)

Modal dialog for launching a new agent from the UI. Triggered by the "+ New Agent" button in the TopBar.

- **Card selection:** Fetches backlog cards via `getTrelloBacklogCards()` and displays them in a selectable list.
- **Branch preview:** Shows auto-generated branch name (mirrors `AgentManager.branchNameFromCard` logic).
- **Creation flow:** Calls `createAgent(card)` via IPC → main process uses pre-parsed runbook (or parses on-demand as fallback), creates worktree + state machine. Then auto-starts orchestration via `startOrchestration(agentId)`.
- **IPC channel:** `agent:create` — handler in `ipc-handlers.ts` loads config, uses cached runbook, delegates to `agentManager.createAgent()`.

### Runbook View (`src/renderer/src/components/RunbookView.tsx`)

Dedicated screen for viewing the parsed runbook. Accessible via the "Runbook" button in the TopBar.

- **Eager parsing:** The runbook is parsed on app startup (config load) and on config save, cached in memory (`activeRunbook` in `ipc-handlers.ts`). Agent creation uses this pre-parsed runbook instantly.
- **Phase/step display:** Shows all phases as collapsible sections with numbered steps, titles, and descriptions.
- **Refresh button:** Re-parses CONTRIBUTING.md on demand via `runbook:refresh` IPC channel.
- **IPC channels:** `runbook:get` (returns cached runbook), `runbook:refresh` (re-parses and returns).

## Development Workflow

**Every Trello card must follow the runbook in [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md).** This is a 6-phase, 29-step process: pick up → research → design → implement → verify → review & ship. No skipping phases. Create a tracker doc before starting.

### Commands

- `npm run dev` — Launch Electron app with hot reload
- `npm run build` — TypeScript check + production build
- `npm run typecheck` — TypeScript type checking only (runs both `typecheck:node` and `typecheck:web`)
- `npm run lint` — Run ESLint
- `npm run format` — Run Prettier
- `npx vitest run` — Run all unit tests
- `npx vitest run src/main/__tests__/foo.test.ts` — Run a single test file
- `npx vitest run -t "test name"` — Run tests matching a name pattern

## Project Structure

- `src/shared/` — Types and constants shared between main process and renderer
- `src/main/` — Electron main process
- `src/preload/` — Preload scripts (context bridge for IPC)
- `src/renderer/` — React frontend (Vite-bundled)
- `electron.vite.config.ts` — Vite config for main/preload/renderer
- `electron-builder.yml` — Packaging configuration
- `docs/` — Decision docs, spike write-ups, tracker files
- `spikes/` — Proof-of-concept scripts from research spikes

## Conventions

### TypeScript

Two tsconfig files: `tsconfig.node.json` (main + preload + shared) and `tsconfig.web.json` (renderer + shared). The root `tsconfig.json` is a project-references wrapper only — it compiles nothing. When adding new source paths, update the correct tsconfig.

### Code Style

Prettier: single quotes, no semicolons, 100-char line width, no trailing commas. EditorConfig: 2-space indent, LF line endings.

### Tests

Tests live in `src/main/__tests__/` using Vitest (no config file — uses defaults). Test files are named `<module>.test.ts`. No vitest config — runs with default settings.

**Integration tests** for the smart approval service call the real LLM (no mocks) to verify Claude correctly identifies dangerous operations. Gated behind `RUN_INTEGRATION` env var — skipped by default during `npx vitest run`.

- `RUN_INTEGRATION=true npx vitest run src/main/__tests__/smart-approval-service.integration.test.ts` — Vitest assertions (pass/fail)
- `npx tsx src/main/__tests__/integration-run-report.ts` — Standalone runner that generates a detailed Markdown report in `docs/`
- Test vectors defined in `integration-test-vectors.ts` (shared between both runners)
- Cost: ~$1.20 per full run, ~7.5 minutes. Each vector = one LLM call.
- **SAFETY:** These tests NEVER execute commands. They only call `evaluatePermission()` which asks the LLM for a yes/no/maybe text decision.

### Import Aliases

- `@renderer/*` — maps to `src/renderer/src/*` (renderer only)
- `@shared/*` — maps to `src/shared/*` (renderer only; main/preload use relative imports)

### IPC Channels

Named `namespace:action` (e.g., `config:load`, `cli:start`, `worktree:list`). Channel name constants live in `src/shared/ipc.ts` (`IpcChannels`). Request-response channels use `ipcMain.handle` / `ipcRenderer.invoke`. The `cli:event` channel is a one-way push from main to renderer via `webContents.send` for streaming CLI session events. Handlers registered in `src/main/ipc-handlers.ts`, exposed to renderer via the `api` object in `src/preload/index.ts` (typed in `src/preload/index.d.ts`).

### Configuration

App config stored at `app.getPath('userData')/config.json`. Config service in `src/main/config-service.ts`. Schema defined in `src/shared/config.ts`. Notable fields:

- **`defaultBranch`** (string, optional) — Explicit base branch for worktree creation. When empty (default), auto-detected via `git symbolic-ref --short HEAD` (falls back to `main`). Configurable in Settings via a dropdown that fetches remote branches from origin.
- **`worktreeBasePath`** (string, optional) — Custom base directory for agent worktrees. When empty (default), worktrees are created as siblings to the repo directory.
- **`trelloBoardId`** — The Settings UI accepts either a raw board ID or a full Trello URL (`https://trello.com/b/<id>/...`). The `extractBoardId()` utility in `src/shared/config.ts` extracts the ID from URLs on input.
- **`trelloListIds`** — `{ backlog: string[], inProgress: string, done: string }` storing Trello list **IDs** directly. `backlog` is an array (multiple lists can serve as card sources). Assigned via the Settings UI: lists are auto-fetched on open, roles assigned via radio buttons. Replaces the old `trelloListNames` text fields — no more runtime name→ID resolution.
- **`runbookParser`** (`'regex' | 'smart'`, default `'regex'`) — Which parser to use for CONTRIBUTING.md. `regex` is the original line-scanner (fast, offline, free). `smart` sends the markdown to Claude via the Agent SDK for AI-powered parsing — handles varied markdown structures and filters out non-workflow sections (reference tables, appendices). Configurable in Settings under the Repository section.
- **`approvalMode`** (`'always' | 'never' | 'smart'`, default `'never'`) — How tool permission requests are handled. `always` auto-approves every request (no UI dialog). `never` always shows the permission dialog. `smart` sends the request to an LLM evaluator — auto-approves on `'yes'`, falls through to the dialog on `'no'`/`'maybe'`. Stored as an instance field on `OrchestrationLoop`, updated on config save via `setApprovalMode()` — takes effect on the next step, not the step currently in flight. Configurable in Settings under the Permissions section.

## Worktree Layout

The repo is checked out in a `main/` subfolder to support git worktrees:

```
C:\Programming\EMAOrchestrator\
  main/          ← git repo root (main branch)
  feat-xxx/      ← worktree for feature branch
  fix-yyy/       ← worktree for bugfix branch
```
