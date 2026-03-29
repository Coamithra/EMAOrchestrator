# Tracker: feat/console-input

## Phase 1: Pick Up the Card
- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress
- [x] Create worktree and branch

## Phase 2: Research
- [x] Read the referenced code (AgentDetailPanel, ChatTerminal, OrchestrationLoop, CliDriver, IPC)
- [x] Trace the call chain (orchestration → driver → SDK streamInput)
- [x] Identify blast radius (ipc.ts, preload, orchestration-loop, renderer components)
- [ ] Research unknowns (SDK streamInput for arbitrary user prompts)
- [ ] Summarize findings

## Phase 3: Design
- [ ] Draft the approach
- [ ] Check for reusable patterns
- [ ] Align with user

## Phase 4: Implement
- [ ] Make the changes
- [ ] Run safety checks (typecheck, lint)

## Phase 5: Verify
- [ ] Smoke test (npm run build)
- [ ] Run existing tests
- [ ] Spot-check diff
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
- [ ] Comment on card
