# Tracker: spike/context-strategy

## Phase 1: Pick Up the Card
- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress
- [x] Create worktree and branch

## Phase 2: Research
- [x] Read the referenced code (CLI driver, agent state machine, session registry)
- [x] Trace the call chain (how prompts flow through the orchestrator)
- [x] Identify the blast radius (what systems context strategy touches)
- [x] Research unknowns (Claude context window sizes, Agent SDK behavior, token counting)
- [x] Summarize findings

## Phase 3: Design
- [x] Draft the approach (analyze all 5 options with concrete numbers)
- [x] Check for reusable patterns
- [x] Align with the user

## Phase 4: Implement
- [x] Write the decision doc (docs/spike-009-context-strategy.md)

## Phase 5: Verify
- [x] Review the decision doc for completeness
- [x] Ensure at least 3 options analyzed with concrete numbers
- [x] Ensure chosen strategy documented with rationale

## Phase 6: Review & Ship
- [x] Update CLAUDE.md if needed
- [x] Commit & push
- [x] Peer review
- [ ] Pull main into branch
- [ ] Re-run smoke tests
- [ ] Return to main checkout
- [ ] Merge to main
- [ ] Clean up worktree
- [ ] Move card to Done
- [ ] Comment on the card
