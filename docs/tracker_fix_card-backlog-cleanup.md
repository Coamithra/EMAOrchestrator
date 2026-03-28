# Tracker: fix/card-backlog-cleanup

## Phase 1: Pick Up the Card
- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress
- [x] Create worktree and branch

## Phase 2: Research
- [ ] Read the referenced code (index.ts, ipc-handlers.ts, orchestration-loop.ts)
- [ ] Trace the call chain — how cards move to Done on success
- [ ] Identify the blast radius
- [ ] Summarize findings

## Phase 3: Design
- [ ] Draft the approach
- [ ] Check for reusable patterns
- [ ] Align with the user

## Phase 4: Implement
- [ ] Make the changes
- [ ] Run safety checks (typecheck, lint)

## Phase 5: Verify
- [ ] Smoke test — npm run build
- [ ] Run existing tests
- [ ] Spot-check logic
- [ ] Flag what needs manual testing

## Phase 6: Review & Ship
- [ ] Update CLAUDE.md if needed
- [ ] Commit & push
- [ ] Peer review
- [ ] Pull main into branch
- [ ] Re-run smoke tests
- [ ] Merge to main
- [ ] Clean up worktree + branch
- [ ] Move card to Done
- [ ] Comment on card
