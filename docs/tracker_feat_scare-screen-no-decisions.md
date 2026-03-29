# Tracker: feat/scare-screen-no-decisions

## Phase 1: Pick Up the Card
- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress
- [x] Create worktree and branch

## Phase 2: Research
- [ ] Read the referenced code (smart-approval-service, cli-driver, orchestration-loop, PermissionDialog, shared types)
- [ ] Trace the call chain for 'no'/'maybe' decisions
- [ ] Identify the blast radius
- [ ] Summarize findings

## Phase 3: Design
- [ ] Draft the approach (file-by-file changes, edge cases)
- [ ] Check for reusable patterns
- [ ] Align with the user

## Phase 4: Implement
- [ ] Make the changes
- [ ] Run safety checks (typecheck, lint)

## Phase 5: Verify
- [ ] npm run build
- [ ] Run existing tests
- [ ] Spot-check the diff
- [ ] Flag what needs manual testing

## Phase 6: Review & Ship
- [ ] Update CLAUDE.md
- [ ] Commit & push
- [ ] Peer review (fresh agent)
- [ ] Pull main into branch
- [ ] Re-run smoke tests
- [ ] Merge to main
- [ ] Clean up worktree
- [ ] Move card to Done
- [ ] Comment on card
