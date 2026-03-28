# Tracker: feat/test-suite-auto-approval

## Phase 1: Pick Up the Card
- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress
- [x] Create worktree and branch

## Phase 2: Research
- [x] Read smart-approval-service.ts
- [x] Read cli-driver.ts (integration point)
- [x] Review existing test patterns (smart-runbook-parser.test.ts, cli-driver.test.ts)
- [x] Research adversarial attack vectors for LLM-based approval systems
- [x] Research parseDecision edge cases
- [x] Summarize findings

## Phase 3: Design
- [ ] Draft test suite structure and approach
- [ ] Check for reusable patterns from existing tests
- [ ] Align with user

## Phase 4: Implement
- [ ] Write smart-approval-service.test.ts

## Phase 5: Verify
- [ ] Run tests: npx vitest run
- [ ] Run typecheck: npm run typecheck
- [ ] Run lint: npm run lint
- [ ] Spot-check the diff

## Phase 6: Review & Ship
- [ ] Update CLAUDE.md if needed
- [ ] Commit & push
- [ ] Peer review (fresh agent)
- [ ] Pull main, re-run smoke tests
- [ ] Merge to main & push
- [ ] Clean up worktree & branch
- [ ] Move card to Done
- [ ] Comment on card
