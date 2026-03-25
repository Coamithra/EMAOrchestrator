# Tracker: feat/config-settings

## Phase 1: Pick Up the Card

- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress

## Phase 2: Research

- [x] Read the referenced code (main process, renderer, preload)
- [x] Trace the call chain (IPC pattern, app structure)
- [x] Identify the blast radius (fresh scaffold — minimal existing code)
- [ ] Research unknowns (Electron app.getPath, electron-store vs manual JSON)
- [ ] Summarize findings

## Phase 3: Design

- [ ] Draft the approach (plan mode)
- [ ] Check for reusable patterns
- [ ] Align with the user

## Phase 4: Branch & Implement

- [ ] Create feature branch `feat/config-settings`
- [ ] Implement config service (main process)
- [ ] Implement IPC handlers (preload + main)
- [ ] Implement Settings UI (renderer)
- [ ] Implement first-run setup flow
- [ ] Run safety checks (typecheck, lint)

## Phase 5: Verify

- [ ] Smoke test (npm run dev)
- [ ] Spot-check logic (read through diff)
- [ ] Flag what needs manual testing

## Phase 6: Review & Ship

- [ ] Update CLAUDE.md if needed
- [ ] Commit & push
- [ ] Peer review (fresh agent)
- [ ] Pull main into branch
- [ ] Re-run smoke tests
- [ ] Merge to main
- [ ] Clean up branch
- [ ] Move card to Done
- [ ] Comment on card
