# Contributing: Tackling a Trello Card

Step-by-step workflow for picking up and completing any card from the project's Trello board.

---

## Before You Start: Create a Tracker Doc

**This is mandatory.** Before doing anything else, create a file `docs/tracker_<branch-name>.md` with every step from this runbook as a checkbox list. Example:

```markdown
# Tracker: fix/some-bug

## Phase 1: Pick Up the Card

- [ ] Pull latest main
- [ ] Read the card (description, comments, linked docs)
- [ ] Move card to In Progress

## Phase 2: Research

- [ ] Read the referenced code
- [ ] Trace the call chain
      ...
```

Check off each step as you complete it. This is your source of truth for progress — if you get interrupted or context is lost, the tracker tells you exactly where you left off. Delete the tracker file after the card is shipped.

---

## Phase 1: Pick Up the Card

1. **Pull latest main** — `git pull origin main` to ensure you're working from the newest code
2. **Pull the card** — Read the full card description, comments, and any linked docs
3. **Move card to In Progress** — Move the card to the "In Progress" list

## Phase 2: Research

Dig into the problem before proposing solutions. Use `/research` for topics that need external context.

3. **Read the referenced code** — Every card cites specific files and line numbers. Read those files to understand current state (card descriptions may be stale)
4. **Trace the call chain** — For bugs, trace how the problematic code gets invoked. For features, trace the existing system the feature plugs into
5. **Identify the blast radius** — What other systems touch this code? Check imports, callers, and module boundaries
6. **Research unknowns** — Use `/research` for anything that needs external knowledge:
   - Bugs: known pitfalls in the library/pattern involved
   - Features: prior art, best practices, design patterns relevant to the feature
   - Refactoring: established patterns for the refactor type
7. **Summarize findings** — Brief writeup of what you learned: root cause (bugs), design options (features), or risk areas (refactors). This becomes input to the design phase

## Phase 3: Design

8. **Draft the approach** — Write a plan file with:
   - **Context**: what the card is about and why it matters
   - **Approach**: the specific changes, file by file
   - **Edge cases**: what could go wrong, what existing behavior must be preserved
9. **Check for reusable patterns** — Look for existing utilities, constants, or conventions that apply
10. **Align with the user** — Present the plan, get approval before writing code

## Phase 4: Branch & Implement

11. **Create a feature branch** — Branch off `main` with a descriptive name:
    - Bugs: `fix/<card-name>`
    - Features: `feat/<card-name>`
    - Refactoring: `refactor/<card-name>`
    - Push the empty branch to origin: `git push -u origin <branch>`
12. **Make the changes** — Edit files per the approved plan. Follow project conventions
13. **Run safety checks** — Run any applicable test suites or linters

## Phase 5: Verify

14. **Smoke test** — Quick startup/import check to catch syntax errors and broken dependencies
15. **Run existing tests** — Run all test files
16. **Spot-check logic** — Read through the diff looking for obvious issues: typos, off-by-ones, missing edge cases
17. **Flag what needs manual testing** — Leave a note for the user of what to verify manually

## Phase 6: Review & Ship

18. **Update CLAUDE.md** — If the change introduces new conventions, gotchas, or modifies documented behavior, update `CLAUDE.md` before committing
19. **Commit & push** — Descriptive message, reference the card number if useful. Push to the feature branch
20. **Peer review** — Spawn a fresh agent to review the branch diff (`git diff main...<branch>`). The agent has no prior context, so it catches things we've gone blind to
21. **Pull main into the branch** — `git pull origin main` to pick up any changes that landed while you worked. Resolve conflicts if any
22. **Re-run smoke tests** — Make sure the merge didn't break anything
23. **Merge to main** — `git checkout main && git merge <branch> && git push`
24. **Clean up the branch** — `git branch -d <branch> && git push origin --delete <branch>`
25. **Move card to Done** — Move the card to the "Done" list
26. **Comment on the card** — Add a summary to the Trello card: what changed, which files, commit hash, and what needs manual testing

---

## Quick Reference: Card Categories

| Category                 | Key concerns                                                            |
| ------------------------ | ----------------------------------------------------------------------- |
| **Critical bugs**        | Race conditions, async safety, state corruption. Test under load        |
| **Non-critical bugs**    | Edge cases, missing validation. Usually single-file fixes               |
| **In-progress features** | Have existing plan docs. Read the plan first, pick up where it left off |
| **Future features**      | Larger scope. May need multi-session work                               |
| **Refactoring**          | High blast radius, low urgency. Test everything nearby after changes    |
