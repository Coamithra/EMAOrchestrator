# Contributing: Tackling a Trello Card

The generic, project-agnostic runbook for picking up and shipping a Trello card.
**It applies only when the project actually has a Trello board and a GitHub repo** —
check the project's local `CLAUDE.md` for the specifics: board id, default branch
(`main` vs `master`), Trello backend (remote `trello` vs `--backend local`), list
names, worktree layout + per-worktree bootstrap, and the verification gate. If the
local `CLAUDE.md` shows no board / no repo, this runbook doesn't apply.

Throughout, substitute the project's specifics from its `CLAUDE.md`:
- `<branch>` → the project's default branch (`main` or `master`).
- `trello ...` → add `--backend local` if the board is on the local backend.
- `--board <id>` → the project's board id.
- list names (`To Do` / `Doing` / `Done`) → the project's actual columns.

(Per global prefs, commands may be `rtk`-prefixed; the `edit_unicode.py` helper still
applies to any edit touching `→` / `—` / curly quotes.)

---

## Quick ship (no card / small change)

Not every change is a Trello card. For a quick fix or doc tweak that doesn't warrant
the full runbook below, the default ship flow is **PR + auto self-merge**:

```
git checkout -b <prefix>/<short-name>             # off the default branch
git add <files> && git commit -m "..."            # only the files you touched
git push -u origin <branch>
gh pr create --fill                               # PR record + URL, no clicking
gh pr merge --merge                               # self-merge; use --merge, not --squash
git checkout <branch> && git pull origin <branch> # fast-forward local default branch
```

**No approval needed.** The default branch is unprotected on these solo repos, so GitHub
disabling the "Approve" button on your *own* PR is irrelevant — a required review only
applies under a branch-protection rule, and these repos have none. Don't stop to ask the
user to approve or open the PR by hand. (If the user says "just merge / direct", skip the
PR entirely and fast-forward the default branch.) Use `--merge` (a real merge commit),
not `--squash`, so the branch's commits stay reachable and `git branch -d` still works.
The full card runbook (Phase 6) uses this same merge step inside the worktree flow.

---

## Before You Start: Create a Tracker Doc

Before anything else, create a tracker file (`plans/tracker_<branch>.md` or
`docs/tracker_<branch>.md` — match the project's plans/docs layout) with every step from
this runbook as a checkbox list. Example:

```markdown
# Tracker: fix/some-bug

## Phase 1: Pick Up the Card
- [ ] Claim the top card with `trello grab`, before anything else
- [ ] Pull latest <branch>
- [ ] Read the card (description, comments, linked plan)
- [ ] Create worktree and branch

## Phase 2: Research
- [ ] Read the referenced code
- [ ] Trace the call chain
...
```

Check off each step as you complete it — it's your source of truth for progress if you
get interrupted or context is lost. Delete the tracker file after the card ships.

---

## Worktree Quick Reference

All card work happens in an isolated **git worktree** so multiple agents can work on
different cards simultaneously without clobbering each other or the root checkout.
**The root checkout stays on the default branch — never switch it to a feature branch.**
Worktree location varies by project (`.trees/`, `.claude/worktrees/`, or sibling
directories) — see the local `CLAUDE.md`.

| Command | What it does |
|---------|-------------|
| `git worktree add <dir> -b <branch> <default-branch>` | Create a new worktree + branch |
| `git worktree list` | Show all active worktrees |
| `git worktree remove <dir>` | Remove a worktree (clean up) |
| `git worktree prune` | Clean up stale worktree references |

**Key rules:**
- Each worktree gets its own branch; a branch can only be checked out in one worktree at a time.
- **Gitignored files do NOT exist in a fresh worktree** — recreate whatever the project
  needs before running anything (`.env`, a `.venv` + install, `node_modules` via
  `npm install`, etc.; see the local `CLAUDE.md`'s per-worktree bootstrap).
- **Slot naming (if the project uses it):** some projects use fixed slot directories
  `wt1`..`wt8` instead of branch-named folders. Pick the lowest free slot from
  `git worktree list`; if `git worktree add` fails because the dir exists, another agent
  grabbed that slot in the same instant — take the next one. Branch names stay descriptive;
  the slot is only the folder. Projects with per-slot dev-server ports document them locally.
- **Windows worktree-remove "Permission denied":** `cd` the shell out of the worktree first
  (the Bash tool's own cwd can't be inside the dir you're deleting), kill any dev server /
  `python.exe` still running from it, then retry. A freshly-synced `.venv` being scanned by
  Defender / Search indexer can hold a transient lock — retry after a few seconds.
  `git worktree remove --force` still unregisters it from git even when the physical folder
  can't be deleted.

---

## Phase 1: Pick Up the Card

**Claim the card FIRST, before any other work.**

### Atomic `grab`

When told to "pick up the top card/ticket" (rather than a specific named card), claim it
in one step:

```
trello --board <id> grab --from "To Do" --to "Doing"
```

(Add `--backend local` for a local-backend board; swap the list names for the project's
columns — on some boards `--from`/`--to` are *required* because the CLI's `To Do`/`Doing`
defaults don't exist there.) `grab` pops the top card of the source list, moves it to the
in-progress list, and prints the card it got you (exits 1 when the source list is empty).
It's safe to fire from several agents at once: each gets a distinct card, so no two collide
on the same ticket. On the **local backend** the grab is **truly atomic** (it takes a store
lock). On the **remote Trello backend** `grab` settles ties with a brief (~10-30s)
claim-comment handshake internally — you never run it by hand. For a *specific named* card,
skip `grab` and move it by hand (step 3 below).

**Expect the card `grab` returns to differ from the one you just saw on top — that's
normal, not a bug.** Between you eyeballing the board and `grab` running, another agent may
have already claimed that top card, so `grab` atomically handed you the next one down. That
race is the whole reason `grab` exists. Don't stop to investigate where the card you saw
"went", and don't assume the board is inconsistent — just work the card `grab` actually
returned.

### Then:

1. **Claim the card** with `grab` — first, nothing before it.
2. **Pull latest** — `git pull origin <branch>` so you start from the newest code.
3. **Read the card** — description, comments, and any linked spec/plan (the plan is the
   long-form source of truth; the card is a pointer). For a *specific* named card you didn't
   `grab`, move it to the in-progress list now:
   `trello --board <id> card move <card_id> <in-progress-list>`.
4. **Create the worktree and branch** — off the default branch, with a descriptive prefix:
   - Bugs: `fix/<short-name>`
   - Features: `feat/<short-name>`
   - Refactoring: `refactor/<short-name>`
   - Docs / plans only: `docs/<short-name>`
   ```
   git worktree add <dir> -b <branch> <default-branch>
   cd <dir>
   # ... per-worktree bootstrap from the local CLAUDE.md (venv/install/.env) ...
   git push -u origin <branch>
   ```
5. **All subsequent work happens inside the worktree.**

---

## Phase 2: Research

Dig into the problem before proposing solutions. Use `/research` for anything that needs
external context (SDK quirks, library contracts, API behaviour).

- **Read the referenced code** — cards and plans cite specific files and line numbers; read
  them, descriptions drift. The architecture map in the local `CLAUDE.md` is the fastest
  orientation.
- **Trace the call chain** — for bugs, how the problematic code gets invoked; for features,
  the existing system the feature plugs into.
- **Identify the blast radius** — what else touches this code (imports, callers, and the
  boundaries / contracts the project's `CLAUDE.md` documents).
- **Research unknowns** — `/research` for external knowledge.
- **Summarize findings** — root cause (bugs), design options (features), or risk areas
  (refactors). Feeds the design phase.

---

## Phase 3: Design

- **Draft the approach** — update or write a plan (`plans/<file>.md` or the project's
  equivalent). Include: **Context** (what the card is about and why it matters), **Design**
  (file-by-file changes, new public API / contracts), **Tests/Verification** (how you'll
  prove it), and **Out of scope** (what you're explicitly *not* doing).
- **Check for reusable patterns** — look for existing utilities and conventions before
  inventing new ones. Match the existing style rather than adding a parallel one.
- **Align with the user** — present the plan, get approval before writing code.
- **Comment the approach on the card** — once the approach is settled, post a SHORT TLDR
  comment so the board reflects the plan: `trello --board <id> comment add <card_id> "<tldr>"`.
  Just the general idea of what you'll do and why, NOT a full plan (point to the
  `plans/<file>.md` for the detail). Use real newlines in the comment, not escape sequences.

---

## Phase 4: Implement

- **Make the changes** per the approved plan. **Follow the project conventions documented in
  the local `CLAUDE.md`** (language version, style/lint rules, type annotations, data-model
  conventions, secrets handling, etc.).
- **Comments**: default to none; add only when the *why* is non-obvious. Don't narrate what
  the code does; identifiers handle that. Match the surrounding code's density and idiom.
- **Document new conventions** — update the local `CLAUDE.md` if the change introduces a new
  convention, contract, knob, gotcha, or file-layout change. `CLAUDE.md` is the source of truth.

---

## Phase 5: Verify

**Run the project's verification gate** (see local `CLAUDE.md` — depending on the project
it's lint + typecheck + tests, a headless smoke suite, a build, and/or a visual +
console-error-free browser check).

- **Lint / typecheck / build** must be clean.
- **Run the tests** the project gates on; never let protected suites regress.
- **Manual smoke** for anything unit tests don't cover (UI, rendering, network, hardware).
  Document the steps in the plan's "Verification" section.
- **Spot-check the diff** — read it once more for typos, off-by-ones, missing `await`, keys
  that don't exist, and dead-code residue.
- **Flag what needs manual testing** — leave the user a note of anything you couldn't fully
  verify.

> **Cost-gated / external actions:** never auto-run anything that spends money or hits a real
> external service (paid-API integration tests, live model calls, GPU renders, real sends to
> contacts, etc.) unless the user explicitly asked for that specific run in the current turn —
> past authorization does not carry over. See the local `CLAUDE.md` for the project's specific
> cost gates.

---

## Phase 6: Review & Ship

1. **Commit** — descriptive message in the project's style (imperative, single-line subject;
   body explains *why* not *what*). Reference the card if useful. Push to the feature branch.
2. **Peer review** — run `/review` (spawns a fresh agent against the branch diff vs the
   default branch, with no prior context). It catches logic errors, missed edge cases,
   convention violations, naming issues we've gone blind to. **Fix every finding before
   proceeding** — even minor ones — unless a fix is a major undertaking, in which case track
   it as a follow-up card.
3. **Pull the default branch into your branch** — `git pull origin <branch>` to pick up
   anything that landed while you worked. Resolve conflicts per the rules below.

### Merge Conflict Rules

1. **Default to the incoming (default-branch) version.** If a conflict is in code you didn't
   intentionally change, accept the default branch's side — someone else fixed a bug or added
   a feature; don't silently revert their work.
2. **Assume incoming changes are important.** Treat every conflict as "the default branch has
   a critical fix" until you've read the diff and confirmed otherwise. Be very careful about
   overwriting new code with your version.
3. **Only keep your side for lines you specifically wrote.** If you and the default branch
   both changed a function, read both carefully and merge surgically — keep their fix, layer
   your change on top.
4. **If the merge is messy, restart from the default branch.** A clean re-apply of your
   change beats a botched merge.
5. **Re-read the final result.** After resolving, read every conflicted file in full — don't
   just trust the conflict markers.

4. **Re-verify after the merge** — re-run the Phase 5 gate so the merge didn't break anything.
5. **Return to the root checkout** — `cd` back to the project root (where the default branch
   is checked out). Remaining steps run from here.
6. **Open a PR and self-merge** — `gh pr create --fill` then `gh pr merge --merge` (real
   merge commit, not `--squash`), then `git pull origin <branch>` to fast-forward the root
   checkout. **No approval needed** (unprotected solo repo) — the PR is a record/URL, don't
   wait on a human. (Direct `git merge <branch> && git push` is the fallback if `gh` is
   unavailable.)
7. **Clean up the worktree and branch** — kill any process still running from the worktree
   FIRST (it holds the directory lock):
   ```
   git worktree remove <dir>
   git worktree prune
   git branch -d <branch>
   git push origin --delete <branch>
   ```
8. **Delete the plan + tracker files** — if the card had a `plans/<file>.md` behind it, delete
   it now (the plans directory is for *open* work only); delete the per-card tracker doc.
   Leave durable docs (architecture / roadmap files) in place.
9. **Move the card to Done** — `trello --board <id> card move <card_id> <done-list>`.
10. **Comment on the card** — `trello --board <id> comment add <card_id> "<summary>"`: what
    changed, which files, what it fixes/adds, the commit hash(es), and what needs manual
    testing. **Use real newlines, not `\n` escapes.** Leaves a paper trail for future debugging.
11. **Create follow-up cards** — if review/implementation/testing surfaced out-of-scope issues
    (pre-existing bugs, deferred edge cases), add new cards
    (`trello --board <id> card add "<list>" "<title>" "<desc>"`) referencing the original.
    Don't let follow-up work disappear into commit messages.
12. **Write an overview for the user** — the closing handoff: what changed (the user-facing
    behaviour delta, not a file dump), which files were touched, anything still needing manual
    testing or follow-up, and the commit hash(es) / merged branch. This is how the user picks
    the session up cold and knows the card is actually shipped.

---

## Phase 7: Clean up

Stop any dev servers / app instances / background processes you started, and close any
browser tabs you opened for verification (e.g. via claude-in-chrome) — close the tab(s) and
let the empty MCP tab group auto-remove. :)

---

Project-specific phases, the card-categories table, dev-server ports, auto-deploy behaviour,
and per-project gotchas live in the project's own `CLAUDE.md`.
