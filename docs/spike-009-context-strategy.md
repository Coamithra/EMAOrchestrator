# Spike #009: Context Strategy for Multi-Step Prompts

**Date:** 2026-03-26
**Status:** Decision made
**Card:** [#009](https://trello.com/c/nGfEA9Dr)
**Depends on:** Spike #003 (CLI interaction model)
**Blocks:** #010 (Step prompt generator)

---

## Context

When the orchestrator advances an agent to step N, the prompt needs context from steps 1..N-1. Naively re-injecting all prior output into each prompt would consume tokens unnecessarily and could blow up the context window. This spike determines the right strategy.

---

## Options Analyzed

### Option 1: Full Output Carry-Forward

Re-inject all prior step outputs into each new step's prompt.

**Analysis:**
- A typical runbook step produces 10-30K tokens of output (estimated from manual Claude Code sessions running the CONTRIBUTING.md workflow)
- 29 steps × 20K average = ~580K tokens of accumulated output
- With prompt overhead, this approaches 600-700K tokens by the final step
- Within the 1M context window, but wasteful — every step re-sends everything
- API cost scales quadratically: step N sends N × avg_step_output tokens as input
- For a 29-step runbook: ~8.7M cumulative input tokens (sum of 1+2+...+29 × 20K)

**Verdict:** Feasible but expensive and unnecessary.

### Option 2: Summary-Per-Step

After each step completes, ask Claude to produce a one-paragraph summary. Carry only summaries forward into subsequent step prompts.

**Analysis:**
- Summary ~200 tokens per step. 29 steps = ~5,800 tokens of context — very compact
- Requires an extra API call per step (or appending "summarize what you just did" to each prompt)
- Risk: summaries may lose critical details (file paths, decisions, error context) that later steps need
- Implementation: moderate complexity — need summary extraction logic and storage

**Verdict:** Effective compression but adds complexity and latency. Loses detail.

### Option 3: Key Artifacts Only

Extract structured outputs per step (file paths changed, decisions made, commit hashes) and carry those forward.

**Analysis:**
- Most compact representation — structured JSON, ~500 tokens per step
- Requires defining an extraction schema and parsing Claude's output to fill it
- Significant implementation effort for questionable value
- Rigid: any new artifact type requires schema changes
- Works well for the "ship" phases but poorly for research/design phases where output is unstructured prose

**Verdict:** Over-engineered for this use case. High effort, brittle.

### Option 4: Sliding Window

Carry full output of last N steps + summaries of older steps.

**Analysis:**
- Hybrid of Options 1 and 2
- Preserves detail for recent context, compresses older context
- Requires both summary extraction (Option 2) and window management logic
- Tuning N is guesswork — some steps depend on context from many steps back (e.g., Phase 5 verification needs Phase 2 research findings)

**Verdict:** The SDK's auto-compaction already implements a superior version of this. Reinventing it is pointless.

### Option 5: Rely on Conversation Context (Single Long-Lived Session)

Use one SDK session per agent. Each step prompt is sent as a new message within the same conversation. Prior steps are already in Claude's context — no re-injection needed.

**Analysis:**
- **Zero implementation effort** for context management — the orchestrator just sends the next step prompt
- The Agent SDK maintains full conversation history via session persistence (JSONL transcript files on disk)
- Session resumption works via `resume: sessionId` (already implemented in our CLI driver)
- Within a single session, `streamInput()` can send follow-up messages without spawning a new subprocess
- **Assumption: 1M token context window.** Claude Opus 4.6 and Sonnet 4.6 have 1M natively. Older models (Claude 3.5 Sonnet, Claude 4 Sonnet without beta header) have 200K — this strategy requires 1M and the orchestrator should enforce this via model selection. If a smaller-window model is configured, auto-compaction becomes the primary mechanism rather than a safety net.
- **Safety net: SDK auto-compaction** kicks in automatically if context approaches the limit, summarizing older messages without any orchestrator intervention

**Context budget math (assuming 1M context):**
- 29 steps × ~20K avg assistant output = ~580K tokens
- 29 step prompts × ~2K avg input = ~58K tokens
- System prompt + runbook + card description ≈ 5-10K tokens
- Output generation room for current step ≈ 20-30K tokens
- **Total ≈ 670K tokens — well within 1M, with ~330K headroom**
- Even with verbose steps (30K output each): 29×30K output + 29×2K input + 10K system + 30K generation room ≈ 970K — tight but fits
- If it exceeds 1M, auto-compaction handles it transparently
- **Note:** API cost is similar to Option 1 — at turn N, Claude re-reads the full conversation history. The advantage of Option 5 is implementation simplicity, not cost savings.

**Auto-compaction details:**
- The SDK emits `SDKCompactBoundaryMessage` (type `system`, subtype `compact_boundary`) when compaction occurs
- Includes `compact_metadata.pre_tokens` — token count before compaction
- The orchestrator can listen for this event for observability but doesn't need to act on it
- Compaction preserves the essential conversation flow while reducing token count

---

## Decision: Option 5 (Rely on Conversation Context)

**Use a single long-lived SDK session per agent.** The orchestrator sends each runbook step as a new prompt within the same session. No manual context injection, summarization, or sliding window needed.

### Why This Wins

1. **Zero context management code** — the SDK and Claude handle it
2. **Full fidelity** — Claude has access to everything it said and did in prior steps, not a lossy summary
3. **Validated by manual usage** — the CONTRIBUTING.md workflow has been run manually in single Claude Code sessions without hitting context limits
4. **Auto-compaction as safety net** — if a session somehow exceeds 1M tokens, the SDK compacts automatically
5. **Session resumption works** — if the app crashes, `resume: sessionId` restores full context from the JSONL transcript

### Step Advancement Mechanism

Each runbook step is a separate `query()` call with `resume: previousSessionId`. This means:
- Step 1: `query({ prompt: step1Prompt, options: { cwd } })` — returns `sessionId`
- Step 2: `query({ prompt: step2Prompt, options: { resume: sessionId, cwd } })` — resumes the session
- Step N: `query({ prompt: stepNPrompt, options: { resume: sessionId, cwd } })` — same pattern

Each `query()` call spawns a new Claude Code subprocess, but the SDK loads the full session transcript from disk (JSONL files in `~/.claude/projects/<hash>/`), so Claude has the full conversation history. This is distinct from `streamInput()`, which sends messages within a single running subprocess — `streamInput()` is used for `AskUserQuestion` responses within a step, not for step-to-step advancement.

**Implication for CliDriver:** The current `CliDriver.startSession()` can only be called when state is `'idle'`. The orchestration loop (#013) will need to create a new `CliDriver` instance per step (or add a `reset()` method). Each instance uses `resume: sessionId` to continue the same conversation. This is a design detail for #013, not a context strategy concern.

### What the Orchestrator Does

1. **Start:** Call `query()` with the first step's prompt and the agent's worktree as `cwd`. Capture `sessionId` from the `system/init` event.
2. **Advance:** For each subsequent step, create a new `query()` call with `resume: sessionId` and the new step's prompt. The SDK loads prior conversation from disk.
3. **Observe (optional):** Listen for `compact_boundary` events to log when compaction occurs — useful for debugging but no action required
4. **Track:** The agent state machine tracks which steps are complete (for UI display and crash recovery), but this is independent of context management

### What #010 (Step Prompt Generator) Needs to Know

The step prompt generator does **not** need to inject prior-step context. Each generated prompt should contain only:
- The current step's task description
- Step-specific constraints or expected output format
- Completion signaling instructions

Prior context is already in the session. The generator's job is purely to articulate "what to do next," not to rebuild history.

---

## Impact on Downstream Cards

### #010 Step Prompt Generator
- **Simplified scope:** No context injection logic needed
- Prompts are step-focused, not history-carrying
- No context size budgeting required

### #012 State Persistence
- Must persist `sessionId` per agent so sessions can be resumed after app restart
- Step completion tracking is for the orchestrator's state machine, not for context management

### #013 Orchestration Loop
- Loop calls `query()` with `resume: sessionId` for each step (new `CliDriver` instance or reset per step)
- No context assembly step between steps

---

## Key References

- [Agent SDK sessions docs](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/sdk#sessions)
- [Context windows - Claude API docs](https://docs.anthropic.com/en/docs/build-with-claude/context-windows)
- [Compaction - Claude API docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- [Agent SDK reference](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/sdk)
- Spike #003 decision doc: `docs/spike-003-cli-interaction-model.md`
