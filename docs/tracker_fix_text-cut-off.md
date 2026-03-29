# Tracker: fix/text-cut-off

## Phase 1: Pick Up the Card
- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress
- [x] Create worktree and branch

## Phase 2: Research
- [x] Read the referenced code (message-stream-service.ts, ChatTerminal.tsx, cli-driver.ts)
- [x] Trace the call chain (stream:text → text accumulator → finalize → block:updated)
- [x] Identify the blast radius
- [x] Research unknowns
- [x] Summarize findings

## Phase 3: Design
- [x] Draft the approach
- [x] Check for reusable patterns
- [x] Align with the user

## Phase 4: Implement
- [x] Make the changes
- [ ] Run safety checks (typecheck, lint)

## Phase 5: Verify
- [ ] Smoke test (npm run build)
- [ ] Run existing tests
- [ ] Spot-check logic
- [ ] Flag what needs manual testing

## Phase 6: Review & Ship
- [ ] Update CLAUDE.md (if needed)
- [ ] Commit & push
- [ ] Peer review
- [ ] Pull main into branch
- [ ] Re-run smoke tests
- [ ] Merge to main
- [ ] Clean up worktree
- [ ] Move card to Done
- [ ] Comment on the card
