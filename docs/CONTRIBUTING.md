# Contributing: Tackling a Trello Card

Step-by-step workflow for picking up and completing any card from the [EMAOrchestrator Trello board](https://trello.com/b/MibMpIB8/emaorchestrator).

---

## Before You Start: Create a Tracker Doc

**This is mandatory.** Before doing anything else, create a file `docs/tracker_<branch>.md` with every step from this runbook as a checkbox list. Example:

```markdown
# Tracker: fix/some-bug

## Phase 1: Pick Up the Card
- [ ] Pull latest main
- [ ] Read the card (description, comments, linked docs)
- [ ] Move card to In Progress
- [ ] Create worktree and branch

## Phase 2: Research
- [ ] Read the referenced code
- [ ] Trace the call chain
...
```

Check off each step as you complete it. This is your source of truth for progress — if you get interrupted or context is lost, the tracker tells you exactly where you left off. Delete the tracker file after the card is shipped.

---

## Worktree Quick Reference

All work happens in an isolated **git worktree** as a sibling directory to `main/`. This lets multiple agents work on different cards simultaneously without interfering with each other. The `main/` checkout stays on `main` — never switch it to a feature branch.

| Command | What it does |
|---------|-------------|
| `git worktree add ../<branch> -b <branch> main` | Create a new worktree + branch from main |
| `git worktree list` | Show all active worktrees |
| `git worktree remove ../<branch>` | Remove a worktree (clean up) |
| `git worktree prune` | Clean up stale worktree references |

**Key rules:**
- Each worktree gets its own branch; a branch can only be checked out in one worktree at a time
- `node_modules/` does NOT exist in new worktrees — run `npm install` in the new worktree before working
- All worktree directories live as siblings to `main/` (e.g., `../feat-xxx/`, `../fix-yyy/`)

---

## Phase 1: Pick Up the Card

1. **Pull latest main** — `git pull origin main` to ensure you're working from the newest code
2. **Read the card** — Read the full card description, comments, and any linked docs (e.g. spike docs in `docs/`)
3. **Move card to In Progress** — `move_card` to the "In Progress" list
4. **Create worktree and branch** — Branch off `main` with a descriptive name:
    - Bugs: `fix/card-name` (e.g. `fix/terminal-render-race`)
    - Features: `feat/card-name` (e.g. `feat/step-detection`)
    - Refactoring: `refactor/card-name` (e.g. `refactor/ipc-channels`)
    ```
    git worktree add ../<branch> -b <branch> main
    cd ../<branch>
    git push -u origin <branch>
    ```
5. **All subsequent work happens inside `../<branch>/`**

## Phase 2: Research

Dig into the problem before proposing solutions. Use `/research` for topics that need external context (e.g. Electron IPC patterns, Agent SDK behavior, xterm.js rendering).

6. **Read the referenced code** — Every card cites specific files and line numbers. Read those files to understand current state (card descriptions may be stale)
7. **Trace the call chain** — For bugs, trace how the problematic code gets invoked. For features, trace the existing system the feature plugs into
8. **Identify the blast radius** — What other systems touch this code? Check imports, callers, and the main/renderer process boundary
9. **Research unknowns** — Use `/research` for anything that needs external knowledge:
   - Bugs: known pitfalls in the library/pattern involved (e.g. Electron lifecycle, SDK event streams, React state management)
   - Features: prior art, best practices, design patterns relevant to the feature
   - Refactoring: established patterns for the refactor type
10. **Summarize findings** — Brief writeup of what you learned: root cause (bugs), design options (features), or risk areas (refactors). This becomes input to the design phase

## Phase 3: Design

11. **Draft the approach** — Write a plan file with:
   - **Context**: what the card is about and why it matters
   - **Approach**: the specific changes, file by file
   - **Edge cases**: what could go wrong, what existing behavior must be preserved
12. **Check for reusable patterns** — Look for existing utilities, constants, or conventions that apply
13. **Align with the user** — Present the plan, get approval before writing code

## Phase 4: Implement

14. **Make the changes** — Edit files per the approved plan. Follow project conventions
15. **Run safety checks** — Run any applicable test suites or linters: `npm run typecheck`, `npm run lint`

## Phase 5: Verify

16. **Smoke test — does it even start?** — `npm run build` to catch TypeScript errors and broken imports
17. **Run existing tests** — Run all test files
18. **Spot-check logic** — Read through the diff one more time looking for obvious issues: typos, off-by-ones, missing edge cases
19. **Flag what needs manual testing** — Leave a note for the user of what to verify manually (e.g. "launch the app and check terminal output", "test with a real Claude CLI session")

## Phase 6: Review & Ship

20. **Update CLAUDE.md** — If the change introduces new conventions, gotchas, or modifies documented behavior, update `CLAUDE.md` before committing (project rule)
21. **Commit & push** — Descriptive message, reference the card number if useful. Push to the feature branch
22. **Peer review** — Spawn a fresh agent to review the branch diff (`git diff main...<branch>`). The agent has no prior context, so it catches things we've gone blind to: logic errors, missed edge cases, convention violations, naming issues. Fix all findings — even minor ones — unless the fix would be a major undertaking (in which case, note it as a follow-up). Act on all feedback before proceeding
23. **Pull main into the branch** — `git pull origin main` into the feature branch to pick up any changes that landed while we worked. Resolve conflicts if any — see **Merge Conflict Rules** below
24. **Re-run smoke tests** — Make sure the merge didn't break anything: `npm run build`
25. **Return to the main checkout** — `cd` back to the `main/` directory. All remaining steps run from here, not from inside the worktree
26. **Merge to main** — `git merge <branch> && git push`
27. **Clean up** — Remove the worktree, then delete the branch:
    ```
    git worktree remove ../<branch>
    git worktree prune
    git branch -d <branch>
    git push origin --delete <branch>
    ```
28. **Move card to Done** — `move_card` to the "Done" list
29. **Comment on the card** — Add a fix/feature summary to the Trello card: what changed, which files, what it fixes/adds, commit hash, and what needs manual testing. This leaves a paper trail for future debugging

---

## Merge Conflict Rules

When pulling main into your branch (step 23), conflicts mean someone else landed changes while you worked. Follow these principles:

1. **Default to main's version.** If a conflict is in code you didn't intentionally change, accept main's side. Someone else fixed a bug or added a feature — don't silently revert their work.
2. **Assume incoming changes are important.** Treat every conflict as "main has a critical fix" until you've read the diff and confirmed otherwise. Be very careful about overwriting new code with your version.
3. **Only keep your side for lines you specifically wrote.** If you changed a function and main also changed it, read both versions carefully. Merge surgically — keep their fixes, layer your feature on top.
4. **If the merge is messy, restart from main.** When conflicts are widespread or hard to reason about, it's safer to take main wholesale and reimplement your changes on top of the updated code. A clean re-apply is better than a botched merge.
5. **Re-read the final result.** After resolving, read through every conflicted file in full. Make sure the merged code actually makes sense — don't just trust the conflict markers.

---

## Quick Reference: Card Categories

| Category | Key concerns |
|----------|-------------|
| **Critical bugs** | Race conditions, async safety, state corruption. Test under load |
| **Non-critical bugs** | Edge cases, missing validation. Usually single-file fixes |
| **In-progress features** | Have existing plan docs. Read the plan first, pick up where it left off |
| **Future features** | Larger scope. May need multi-session work |
| **Refactoring** | High blast radius, low urgency. Test everything nearby after changes |
