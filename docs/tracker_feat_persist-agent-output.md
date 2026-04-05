# Tracker: feat/persist-agent-output

## Phase 1: Pick Up the Card
- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress
- [x] Create worktree and branch

## Phase 2: Research
- [ ] Read the referenced code (message-stream-service, agent persistence)
- [ ] Trace the call chain (how blocks are created, stored, consumed)
- [ ] Identify the blast radius (what touches message blocks)
- [ ] Research persistence patterns
- [ ] Summarize findings

## Phase 3: Design
- [ ] Draft the approach
- [ ] Check for reusable patterns
- [ ] Align with user

## Phase 4: Implement
- [ ] Make the changes
- [ ] Run safety checks

## Phase 5: Verify
- [ ] Smoke test (npm run build)
- [ ] Run existing tests
- [ ] Spot-check logic
- [ ] Flag manual testing needs

## Phase 6: Review & Ship
- [ ] Update CLAUDE.md
- [ ] Commit & push
- [ ] Peer review
- [ ] Pull main into branch
- [ ] Re-run smoke tests
- [ ] Return to main checkout
- [ ] Merge to main
- [ ] Clean up worktree/branch
- [ ] Move card to Done
- [ ] Comment on the card
