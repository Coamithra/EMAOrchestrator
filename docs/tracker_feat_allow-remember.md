# Tracker: feat/allow-remember

## Phase 1: Pick Up the Card
- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress
- [x] Create worktree and branch

## Phase 2: Research
- [x] Read the referenced code (PermissionDialog, cli-driver types, orchestration loop, IPC)
- [x] Trace the call chain (renderer → IPC → orchestration → CliDriver → SDK)
- [x] Identify the blast radius (shared types, renderer component, orchestration loop, new service)
- [x] Research: Claude CLI settings.local.json format (permissions.allow patterns)
- [x] Summarize findings

## Phase 3: Design
- [x] Draft the approach
- [x] Check for reusable patterns (config-service stateless pattern)
- [x] Align with the user

## Phase 4: Implement
- [ ] Add rememberChoice to PermissionResponse (shared type)
- [ ] Create permission-settings-service.ts (generateToolPattern + addAllowedToolPattern)
- [ ] Update orchestration loop respondToPermission
- [ ] Add "Allow & Remember" button to PermissionDialog
- [ ] Run safety checks (typecheck, lint)

## Phase 5: Verify
- [ ] npm run build
- [ ] npx vitest run (existing + new tests)
- [ ] Spot-check the diff
- [ ] Flag what needs manual testing

## Phase 6: Review & Ship
- [ ] Update CLAUDE.md if needed
- [ ] Commit & push
- [ ] Peer review (spawn fresh agent)
- [ ] Pull main into branch
- [ ] Re-run smoke tests
- [ ] Return to main checkout
- [ ] Merge to main & push
- [ ] Clean up worktree and branch
- [ ] Move card to Done
- [ ] Comment on card
