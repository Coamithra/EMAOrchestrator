# Tracker: feat/cli-driver

Card: #005 Claude CLI driver

## Phase 1: Pick Up the Card
- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress
- [x] Create worktree and branch

## Phase 2: Research
- [x] Read the referenced code (spike-003, existing main process files)
- [x] Trace the call chain (SDK query() → StreamEvent → orchestrator)
- [x] Identify the blast radius (new module, touches shared types + ipc-handlers)
- [x] Research unknowns (Agent SDK API surface, types, lifecycle)
- [x] Summarize findings

## Phase 3: Design
- [x] Draft the approach
- [x] Check for reusable patterns
- [x] Align with the user

## Phase 4: Implement
- [x] Make the changes
- [x] Run safety checks

## Phase 5: Verify
- [x] Smoke test (npm run build)
- [x] Run existing tests
- [x] Spot-check logic
- [ ] Flag what needs manual testing

## Phase 6: Review & Ship
- [ ] Update CLAUDE.md
- [ ] Commit & push
- [ ] Peer review
- [ ] Pull main into branch
- [ ] Re-run smoke tests
- [ ] Return to main checkout
- [ ] Merge to main
- [ ] Clean up worktree
- [ ] Move card to Done
- [ ] Comment on card
