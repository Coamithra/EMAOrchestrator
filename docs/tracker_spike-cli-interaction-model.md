# Tracker: spike/cli-interaction-model

Card: #003 Spike: CLI interaction model (pipes vs PTY vs stream-json)

## Phase 1: Pick Up the Card

- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress

## Phase 2: Research

- [x] Read the referenced code (existing project structure, any CLI-related files)
- [x] Trace the call chain (how agents will be spawned, what consumes their output)
- [x] Identify the blast radius (downstream cards: #005 CLI driver, #018 Agent detail view, #019 Permission UI)
- [x] Research unknowns:
  - [x] Test `claude --output-format stream-json` — document the event schema
  - [x] Test `claude` in a PTY via node-pty — verify xterm.js rendering
  - [x] Test sending follow-up prompts via stdin in both modes
  - [x] Test detecting permission requests in both modes
  - [x] Assess if stream-json and PTY can coexist
- [x] Summarize findings

## Phase 3: Design

- [x] Draft the decision doc with chosen approach and rationale
- [x] Check for reusable patterns
- [x] Align with the user

## Phase 4: Branch & Implement

- [x] Create feature branch `spike/cli-interaction-model`
- [x] Write proof-of-concept scripts for all three options
- [x] Write decision doc

## Phase 5: Verify

- [x] Smoke test PoC scripts (Option A type-checks clean; B and D expected errors for missing optional deps)
- [x] Spot-check logic
- [x] Flag what needs manual testing

## Phase 6: Review & Ship

- [ ] Update CLAUDE.md if needed
- [ ] Commit & push
- [ ] Peer review (fresh agent)
- [ ] Pull main into branch
- [ ] Re-run smoke tests
- [ ] Merge to main
- [ ] Clean up branch
- [ ] Move card to Done
- [ ] Comment on card with summary
- [ ] Update downstream cards (#005, #018, #019)
