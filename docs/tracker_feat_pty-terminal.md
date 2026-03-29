# Tracker: feat/pty-terminal

## Phase 1: Pick Up the Card
- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress
- [x] Create worktree and branch

## Phase 2: Research
- [x] Read the referenced code (cli-driver, terminal-buffer, spike-003)
- [x] Trace the call chain (orchestration-loop → cli-driver → SDK → renderer)
- [x] Identify the blast radius
- [x] Research --permission-prompt-tool (not viable in interactive mode)
- [x] Research node-pty + Electron integration
- [x] Research Claude Code hooks mechanism (viable for PTY permissions!)
- [x] Summarize findings

## Phase 3: Design
- [x] Draft the approach (block-based React chat terminal)
- [x] Check for reusable patterns (OpenCode inspiration)
- [ ] Align with the user

## Phase 4: Implement
- [ ] Phase A: Shared types (message-block.ts) + new IPC events (step:banner, approval:status)
- [ ] Phase B: Backend emission changes (cli-driver.ts, orchestration-loop.ts)
- [ ] Phase C: Message stream service (replaces terminal-buffer-service)
- [ ] Phase D: Block components (TextBlock, ToolBlock, BannerBlock, ResultBlock, StatusBlock, ErrorBlock)
- [ ] Phase E: ChatTerminal component + integration (swap in AgentDetailPanel, App.tsx)
- [ ] Phase F: Dependencies (add react-markdown etc, remove xterm) + delete old files
- [ ] Run safety checks (typecheck, lint)

## Phase 5: Verify
- [ ] npm run build
- [ ] Run existing tests
- [ ] Spot-check logic (read the diff)
- [ ] Flag what needs manual testing

## Phase 6: Review & Ship
- [ ] Update CLAUDE.md
- [ ] Commit & push
- [ ] Peer review
- [ ] Pull main, re-run build
- [ ] Merge to main
- [ ] Clean up worktree
- [ ] Move card to Done
- [ ] Comment on the card
