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

## Development

- `npm run dev` — Launch Electron app with hot reload
- `npm run build` — TypeScript check + production build
- `npm run typecheck` — TypeScript type checking only
- `npm run lint` — Run ESLint
- `npm run format` — Run Prettier

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

Named `namespace:action` (e.g., `config:load`, `dialog:openDirectory`). All use `ipcMain.handle` / `ipcRenderer.invoke` (async request-response). Handlers registered in `src/main/ipc-handlers.ts`, exposed to renderer via the `api` object in `src/preload/index.ts` (typed in `src/preload/index.d.ts`).

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
