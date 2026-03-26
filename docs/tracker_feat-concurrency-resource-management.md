# Tracker: feat/concurrency-resource-management

Card: #014 Concurrency & resource management

## Phase 1: Pick Up the Card
- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress
- [x] Create worktree and branch

## Phase 2: Research
- [ ] Read the referenced code (agent-manager, orchestration-loop, config)
- [ ] Trace the call chain (how agents are created and started)
- [ ] Identify the blast radius (what touches agent creation/start)
- [ ] Research unknowns (concurrency patterns, queue strategies)
- [ ] Summarize findings

## Phase 3: Design
- [ ] Draft the approach (file-by-file changes)
- [ ] Check for reusable patterns
- [ ] Align with the user

## Phase 4: Implement
- [ ] Make the changes
- [ ] Run safety checks (typecheck, lint)

## Phase 5: Verify
- [ ] Smoke test (npm run build)
- [ ] Run existing tests
- [ ] Spot-check logic
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
