# Tracker: feat/ipc-bridge

## Phase 1: Pick Up the Card
- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress
- [x] Create worktree and branch
- [ ] Install dependencies in worktree

## Phase 2: Research
- [ ] Read existing IPC code (preload, ipc-handlers, shared types)
- [ ] Read existing cli-driver, worktree-manager, config-service
- [ ] Trace the call chain (renderer -> preload -> main)
- [ ] Identify blast radius
- [ ] Summarize findings

## Phase 3: Design
- [ ] Draft the approach (shared types, channels, preload API, handlers, event stream)
- [ ] Check for reusable patterns
- [ ] Align with user

## Phase 4: Implement
- [ ] Make changes per approved plan
- [ ] Run safety checks (typecheck, lint)

## Phase 5: Verify
- [ ] npm run build
- [ ] Run existing tests
- [ ] Spot-check diff
- [ ] Flag manual testing needs

## Phase 6: Review & Ship
- [ ] Update CLAUDE.md
- [ ] Commit & push
- [ ] Peer review (spawn fresh agent)
- [ ] Pull main into branch
- [ ] Re-run smoke tests
- [ ] Return to main checkout
- [ ] Merge to main
- [ ] Clean up worktree
- [ ] Move card to Done
- [ ] Comment on card
