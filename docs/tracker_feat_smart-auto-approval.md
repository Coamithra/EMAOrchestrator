# Tracker: feat/smart-auto-approval

## Phase 1: Pick Up the Card
- [x] Pull latest main
- [x] Read the card (description, comments, linked docs)
- [x] Move card to In Progress
- [x] Create worktree and branch

## Phase 2: Research
- [ ] Read the permission flow (canUseTool in cli-driver, orchestration loop, IPC, PermissionDialog)
- [ ] Trace how permission requests flow from SDK → canUseTool → UI → response
- [ ] Identify blast radius — what touches the permission system
- [ ] Research Agent SDK query() for lightweight LLM evaluation calls
- [ ] Summarize findings

## Phase 3: Design
- [ ] Draft approach (config field, smart-approval-service, canUseTool integration, Settings UI)
- [ ] Check for reusable patterns
- [ ] Align with user

## Phase 4: Implement
- [ ] Add config field (approvalMode: always/never/smart)
- [ ] Create smart-approval-service (LLM evaluator)
- [ ] Integrate with canUseTool callback in cli-driver or orchestration loop
- [ ] Add Settings UI for approval mode
- [ ] Update shared types
- [ ] Run typecheck + lint

## Phase 5: Verify
- [ ] npm run build
- [ ] Run tests
- [ ] Spot-check the diff
- [ ] Flag manual testing needs

## Phase 6: Review & Ship
- [ ] Update CLAUDE.md if needed
- [ ] Commit & push
- [ ] Peer review (fresh agent)
- [ ] Pull main, re-build
- [ ] Merge to main & push
- [ ] Clean up worktree + branch
- [ ] Move card to Done + comment
