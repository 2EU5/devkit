---
name: handoff
description: Compact current conversation into handoff doc so fresh agent can continue work. Use for /studio:handoff.
argument-hint: "[what next session will focus on]"
disable-model-invocation: true
---

# Handoff

Write handoff doc from current conversation. Fresh agent with no chat history must continue work from it.

Focus: $ARGUMENTS

## Rules

1. **Location:** Save to OS temp dir (`%TEMP%` on Windows, `$TMPDIR` or `/tmp` elsewhere), not workspace. Name `handoff-<topic>-<YYYY-MM-DD>.md`. Give user full path when done.
2. **Focus:** Arguments given: treat as next session's focus. Tailor doc to it, drop unrelated threads. No arguments: cover all open work.
3. **Contents:**
   - Goal: what user wants.
   - State: done, in progress, not started.
   - Decisions and why. Rejected options and why.
   - Open questions, blockers, risks.
   - Next steps, in order.
   - Suggested skills: which skills next agent should load with Skill tool, and when.
4. **No duplication:** Content already in other artifacts (specs, plans, ADRs, issues, commits, diffs): reference by path or URL. Never copy.
5. **Self-contained:** Reader has no chat context. Absolute paths. No "as discussed above".
6. **Redact:** Remove API keys, tokens, passwords and personal data.
