# Tracker: feat/orchestration-loop

## Phase 1: Pick Up the Card
- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress
- [x] Create worktree and branch

## Phase 2: Research
- [ ] Read the referenced code (cli-driver, agent-state-machine, agent-manager, session-registry, prompt-generator, agent-persistence)
- [ ] Trace the call chain — how these modules connect
- [ ] Identify the blast radius — what the orchestration loop touches
- [ ] Research unknowns — loop patterns, concurrency, error handling
- [ ] Summarize findings

## Phase 3: Design
- [ ] Draft the approach (file-by-file changes, edge cases)
- [ ] Check for reusable patterns
- [ ] Align with user — get approval

## Phase 4: Implement
- [ ] Make the changes per approved plan
- [ ] Run safety checks (typecheck, lint)

## Phase 5: Verify
- [ ] npm run build
- [ ] Run existing tests
- [ ] Spot-check the diff
- [ ] Flag manual testing needs

## Phase 6: Review & Ship
- [ ] Update CLAUDE.md
- [ ] Commit & push
- [ ] Peer review (spawn fresh agent)
- [ ] Pull main into branch
- [ ] Re-run smoke tests
- [ ] Return to main checkout
- [ ] Merge to main
- [ ] Clean up worktree + branch
- [ ] Move card to Done
- [ ] Comment on card
