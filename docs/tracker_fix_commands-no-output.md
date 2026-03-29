# Tracker: fix/commands-no-output

## Phase 1: Pick Up the Card
- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress
- [x] Create worktree and branch

## Phase 2: Research
- [x] Read the referenced code (ToolBlockView, message-stream-service, cli-driver)
- [x] Trace the call chain (tool:result emitted but not forwarded)
- [x] Identify the blast radius (orchestration-loop + session-registry)

## Phase 3: Design
- [x] Draft the approach (add tool:result forwarding in both files)

## Phase 4: Implement
- [x] Add tool:result forwarding in orchestration-loop.ts
- [x] Add tool:result forwarding in session-registry.ts

## Phase 5: Verify
- [ ] npm run build
- [ ] npx vitest run
- [ ] Spot-check diff

## Phase 6: Review & Ship
- [ ] Commit & push
- [ ] Peer review
- [ ] Pull main, re-build
- [ ] Merge to main
- [ ] Clean up worktree
- [ ] Move card to Done
- [ ] Comment on card
