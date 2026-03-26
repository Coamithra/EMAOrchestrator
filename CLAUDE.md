# EMAOrchestrator

"Everybody's Making An" Orchestrator — a runbook enforcer that drives Claude Code sessions step-by-step through a CONTRIBUTING.md workflow, so the human doesn't have to babysit adherence.

## Links

- **Trello Board:** https://trello.com/b/MibMpIB8/emaorchestrator

## Tech Stack

- Electron + React + TypeScript (desktop app)
- `@anthropic-ai/claude-agent-sdk` (spawns Claude CLI, provides typed events and permission callbacks)
- xterm.js (synthetic terminal display — fed by SDK StreamEvents, not a real PTY)

### CLI Interaction Model (Spike #003)

**Decision:** Use the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) for all CLI interaction. The SDK's `query()` returns an AsyncGenerator yielding typed `SDKMessage` objects. Permissions are handled via `canUseTool` callback; `AskUserQuestion` arrives as a tool-use event in the message stream. xterm.js renders a synthetic terminal fed by `stream_event` text deltas — no node-pty or real PTY needed.

**Why not PTY?** Detecting permissions and step completion from ANSI-encoded Ink/React TUI output is fragile and breaks on Claude Code updates. The orchestrator needs structured events, not terminal scraping.

**Full decision doc:** `docs/spike-003-cli-interaction-model.md`

## Architecture

Central controller pattern: orchestrator parses the runbook into discrete steps, spawns one Claude CLI session per Trello card (each in its own git worktree), feeds step-specific prompts, detects completion, and advances automatically.

### CLI Driver (`src/main/cli-driver.ts`)

Wraps the Agent SDK's `query()` into an EventEmitter-based service. One `CliDriver` instance per agent session. Key design:

- **Permission pause/resume:** `canUseTool` callback creates a deferred Promise that blocks the SDK generator until `respondToPermission()` is called. This bridges the async callback to the Electron IPC/UI flow.
- **AskUserQuestion:** Detected as `tool_use` blocks with `name === 'AskUserQuestion'` in `SDKAssistantMessage`. Response sent via `query.streamInput()`.
- **Session resumption:** Pass a previous `sessionId` to `CliSessionOptions` to resume a conversation.
- **Shared types:** `src/shared/cli-driver.ts` defines all event/state types for use across main process and renderer.

### Worktree Manager (`src/main/worktree-manager.ts`)

Wraps `git worktree` commands into an async service. Stateless exported functions (same pattern as config-service). One worktree per agent session, created as siblings to the main repo directory.

- **`createWorktree(repoPath, branch)`** — Creates worktree + new branch from main. Reuses branch if it already exists.
- **`listWorktrees(repoPath)`** — Parses `git worktree list --porcelain` into typed `WorktreeInfo[]`.
- **`removeWorktree(repoPath, worktree)`** — Removes worktree by `WorktreeInfo`, prunes, deletes branch.
- **`getOrphanedWorktrees(repoPath)`** — Returns all non-main worktrees (orphans on startup).
- **`cleanupOrphanedWorktrees(repoPath)`** — Removes all orphans and their branches.
- **Shared types:** `src/shared/worktree.ts` defines `WorktreeInfo` for use across main and renderer.

### Agent State Machine (`src/main/agent-state-machine.ts`)

Tracks a single agent's lifecycle as it works through a parsed runbook. Higher-level than the CliDriver state machine — this orchestrates progress through runbook phases and steps.

- **Dynamic states:** Constructed from the parsed `Runbook` phases. Each phase name becomes a valid state. Fixed states (`idle`, `picking_card`, `error`, `waiting_for_human`, `done`) are always present.
- **Transition enforcement:** Only valid transitions are allowed (e.g., phases must be traversed in order). Invalid transitions throw.
- **Step tracking:** `advanceStep()` marks the current step complete and advances within a phase or auto-transitions to the next phase.
- **Pause/resume:** `setWaitingForHuman()` saves the current phase/step, `resumeFromWaiting()` restores it.
- **Events:** Emits `state:changed`, `step:advanced`, `step:completed`, `phase:completed`, `error`.
- **Shared types:** `src/shared/agent-state.ts` defines `AgentState`, `AgentStateSnapshot`, `AgentStepProgress`, and event types.

### Session Registry (`src/main/session-registry.ts`)

Manages active CliDriver instances and bridges their events to the renderer. One registry for the app.

- **`createSession(options)`** — Creates a CliDriver, wires event forwarding, starts the session. Returns a UUID session ID immediately; the session runs async.
- **`getSession(sessionId)`** — Retrieves a CliDriver by ID (for responding to permissions/questions).
- **`abortAllSessions()`** — Aborts all active sessions (called on app quit).
- **Event forwarding:** All CliDriver events are pushed to the renderer via `webContents.send('cli:event', payload)`. Payload shape: `{ sessionId, event: CliEvent }` (discriminated union).
- Sessions auto-remove from the registry on completion or error.

### IPC Bridge (`src/shared/ipc.ts`)

Central definition of all IPC channel constants and the renderer API type.

- **`IpcChannels`** — String constants for all channels (config, dialog, CLI, worktree). Prevents typos and provides a single source of truth.
- **`CliEvent`** — Discriminated union of all CLI events pushed from main to renderer.
- **`CliEventPayload`** — Wrapper with `sessionId` + `CliEvent` for the `cli:event` channel.
- **`AgentAPI`** — TypeScript interface for the CLI/worktree portion of the preload API.

## Development Workflow

**Every Trello card must follow the runbook in [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md).** This is a 6-phase, 29-step process: pick up → research → design → implement → verify → review & ship. No skipping phases. Create a tracker doc before starting.

### Commands

- `npm run dev` — Launch Electron app with hot reload
- `npm run build` — TypeScript check + production build
- `npm run typecheck` — TypeScript type checking only
- `npm run lint` — Run ESLint
- `npm run format` — Run Prettier
- `npx vitest run` — Run unit tests

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

### Import Aliases

- `@renderer/*` — maps to `src/renderer/src/*` (renderer only)
- `@shared/*` — maps to `src/shared/*` (renderer only; main/preload use relative imports)

### IPC Channels

Named `namespace:action` (e.g., `config:load`, `cli:start`, `worktree:list`). Channel name constants live in `src/shared/ipc.ts` (`IpcChannels`). Request-response channels use `ipcMain.handle` / `ipcRenderer.invoke`. The `cli:event` channel is a one-way push from main to renderer via `webContents.send` for streaming CLI session events. Handlers registered in `src/main/ipc-handlers.ts`, exposed to renderer via the `api` object in `src/preload/index.ts` (typed in `src/preload/index.d.ts`).

### Configuration

App config stored at `app.getPath('userData')/config.json`. Config service in `src/main/config-service.ts`. Schema defined in `src/shared/config.ts`.

## Worktree Layout

The repo is checked out in a `main/` subfolder to support git worktrees:

```
C:\Programming\EMAOrchestrator\
  main/          ← git repo root (main branch)
  feat-xxx/      ← worktree for feature branch
  fix-yyy/       ← worktree for bugfix branch
```
