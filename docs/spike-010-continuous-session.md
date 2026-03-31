# Spike #010: Continuous Session (Eliminate `--resume` Between Steps)

**Date:** 2026-03-31
**Status:** Spike (research complete, ready for implementation)
**Motivation:** Claude Code `--resume` invalidates prompt cache, sending the full conversation at 1.25x price. With 28 resumes per 29-step runbook and up to 3 concurrent agents, this is a significant cost multiplier.

## Problem

The current architecture (per spike #009) runs one `query()` call per runbook step. When the step finishes, the SDK generator completes. The next step calls `query()` again with `resume: sessionId` to chain the conversation. This means:

- **28 resumes per agent** for a 29-step runbook
- **84 resumes per batch** at max concurrency (3 agents)
- Each resume invalidates prompt cache, re-sending the full conversation at **1.25x input token price**
- Cost compounds: step 29's resume replays ~670K tokens of prior conversation

## Proposed Solution

Keep one `query()` running for the entire runbook. Use `AskUserQuestion` as a step-completion signal. The orchestrator auto-responds with the next step's prompt via `streamInput()`.

### Current Flow (28 resumes)

```
query(step 1)  --> generator completes --> result
query(step 2, resume: id) --> generator completes --> result
query(step 3, resume: id) --> generator completes --> result
...
query(step 29, resume: id) --> generator completes --> result
```

### Proposed Flow (0 resumes)

```
query(step 1 prompt)
  --> model works on step 1
  --> model calls AskUserQuestion("STEP_DONE: <summary>")
  --> orchestrator detects STEP_DONE prefix
  --> orchestrator calls advanceStep(), extracts summary
  --> orchestrator responds via streamInput() with step 2 prompt
  --> model works on step 2
  --> model calls AskUserQuestion("STEP_DONE: <summary>")
  --> ...repeat...
  --> step 29: model finishes naturally (no AskUserQuestion)
  --> generator completes --> result
```

## Technical Validation

### `streamInput()` supports arbitrary user messages

Confirmed from SDK types (`@anthropic-ai/claude-agent-sdk/sdk.d.ts`):

```typescript
interface Query extends AsyncGenerator<SDKMessage, void> {
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
}

type SDKUserMessage = {
  type: 'user';
  message: MessageParam;        // { role: 'user', content: string }
  parent_tool_use_id: string | null;  // null = standalone user message
  session_id: string;
  // ...
};
```

The existing `respondToUserQuestion()` in `cli-driver.ts:183-209` already uses this exact pattern with `parent_tool_use_id: null`. Sending the next step's prompt is structurally identical to answering a user question.

### `AskUserQuestion` detection already works

`cli-driver.ts:322-342` detects `AskUserQuestion` tool calls in assistant messages, creates a `UserQuestionRequest`, sets state to `waiting_user_input`, and emits `user:question`. The orchestration loop already handles this event.

### Distinguishing step-done signals from real questions

Convention: step-done summaries are prefixed with `STEP_DONE: `. The orchestrator checks for this prefix in the `user:question` handler:

- **Has prefix:** Auto-respond with next step prompt. No UI dialog.
- **No prefix:** Real question from the model. Show UI, wait for human, forward answer.

This is safe because:
- Steps with real human interaction (step 13: approval, step 19: manual testing) produce unprefixed questions via existing prompt instructions
- The model only produces `STEP_DONE:` prefixed questions from the explicit prompt instruction
- If the model has a genuine question during a non-interaction step, it won't prefix it

### Last step handling

Step 29 (final step) gets the current completion instruction ("provide a brief summary") instead of the AskUserQuestion instruction. The model writes its summary as text, the generator completes naturally, and `session:result` fires.

## Changes Required

### 1. `prompt-generator.ts` — Completion signal

**Current** (line 90-93):
```typescript
parts.push(
  '',
  '---',
  'When you have completed this step, provide a brief summary of what you accomplished.'
)
```

**Proposed:**
```typescript
if (isLastStep) {
  parts.push(
    '',
    '---',
    'When you have completed this step, provide a brief summary of what you accomplished.'
  )
} else {
  parts.push(
    '',
    '---',
    'When you have completed this step, call the AskUserQuestion tool with your message',
    'starting with "STEP_DONE: " followed by a brief summary of what you accomplished.',
    'Example: AskUserQuestion("STEP_DONE: Implemented the login form with validation")'
  )
}
```

Requires adding `isLastStep: boolean` to `StepPromptContext`.

### 2. `orchestration-loop.ts` — Single-session step loop

Replace the current pattern where `runStep()` is called per step with a single long-lived session. The key change is in `runAgentLoop()`:

**Current pattern:**
```typescript
while (!entry.stopped) {
  // ... get step ...
  const prompt = generateStepPrompt(context)
  const ok = await this.runStep(entry, prompt, ...)  // new query() per step
  if (!ok) break
  sm.advanceStep()
}
```

**Proposed pattern:**
```typescript
// Start a single session with step 1's prompt
// Wire user:question handler to detect STEP_DONE and auto-respond with next step
// The session stays alive across all steps
const ok = await this.runContinuousSession(entry, config)
```

The new `runContinuousSession()` method:
1. Creates ONE `CliDriver` and ONE `query()` call with step 1's prompt
2. Wires `user:question` to a handler that:
   a. Checks for `STEP_DONE:` prefix
   b. If step-done: extracts summary, calls `advanceStep()`, generates next step prompt, responds via driver's `respondToUserQuestion()` with the next prompt
   c. If real question: emits to UI as before (blocks until human responds)
3. Waits for `session:result` (fires after step 29 completes)

### 3. `cli-driver.ts` — Minor: add auto-response hook

Add an optional callback to `CliSessionOptions` or `CliDriver` that intercepts `user:question` events before they reach the orchestration loop. This keeps the detection logic clean:

```typescript
// Option A: callback on the driver
driver.onUserQuestion = (request) => {
  if (request.question.startsWith('STEP_DONE: ')) {
    return { autoRespond: nextStepPrompt }  // auto-respond, don't emit
  }
  return null  // emit as normal
}
```

Or simply handle it entirely in the orchestration loop's event handler (no driver changes needed).

## Edge Cases

### Permission pauses
Work unchanged. `canUseTool` blocks the generator with a deferred promise inside the single `query()` call. No resume needed.

### Stop/restart
- **Stop:** `driver.abort()` ends the single query. Session ID is preserved.
- **Restart:** One `query()` with `resume: sessionId` to get back in. Then continuous from there. **1 resume instead of 28.**

### App crash recovery
Same as current: `sessionId` is `null` after restore. Fresh session starts. Not worse than today.

### Model forgets `AskUserQuestion`
The generator completes (model produces text without a tool call). `session:result` fires. The orchestrator detects the step wasn't properly signaled. Fallback: treat as step completion, extract summary from last assistant text (same as current behavior), and do ONE resume for the next step.

### `maxTurns` limit
Must be high enough for all 29 steps' worth of tool-use turns. Current default is unbounded (SDK default). If a limit is set, it should be at least ~2000 (29 steps x ~50 tool turns each, conservatively).

### Steps with real `AskUserQuestion` (steps 13, 19)
These steps instruct the model to call `AskUserQuestion` for human interaction. The model calls it WITHOUT the `STEP_DONE:` prefix (per existing prompt instructions). The orchestrator shows the UI dialog, waits for human input, forwards it. Then the model continues working and eventually calls `AskUserQuestion` WITH the `STEP_DONE:` prefix when the step is actually done.

## Cost Impact

Assuming 670K tokens of conversation context at step 29:

| Metric | Current (28 resumes) | Proposed (0 resumes) |
|--------|---------------------|---------------------|
| Resume calls per agent | 28 | 0 (1 on restart) |
| Cache invalidations | 28 | 0 |
| Extra input cost (1.25x on replayed tokens) | ~$2-5 per agent run | ~$0 |
| Resumes per 3-agent batch | 84 | 0 |

## Risks

1. **SDK behavior:** `streamInput()` with `parent_tool_use_id: null` is used for user question responses today, but sending a full step prompt this way is a novel use. Needs integration testing.
2. **Model compliance:** The model must reliably call `AskUserQuestion` with the `STEP_DONE:` prefix. Prompt engineering quality matters. Fallback to resume-on-miss mitigates this.
3. **Long-running generator:** A single `query()` call spanning 29 steps could run for hours. Need to verify the SDK handles long-lived generators gracefully (no timeouts, memory leaks, etc.).

## Decision

**Proceed with implementation.** The approach eliminates 28 resumes per agent with well-understood fallback behavior. The primary risk (model compliance) is mitigable with a prefix convention and resume fallback.
