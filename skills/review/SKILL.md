---
name: review
description: Review a subject (file, skill, code, plan, design, doc) and flag issues to correct and improvements to make. Use for /review, or when the user says "review <subject>".
argument-hint: <subject>
---

# Review

Check subject. Flag issues to correct, improvements to make.

Subject: $ARGUMENTS

## Rules

1. **Subject:** No subject given: ask what to review. Resolve subject to concrete files/things before review.
2. **Reviewer:** Spawn one subagent (`general-purpose`) for review. Give it subject, context from this chat, and these rules. Subagent reads only, never edits.
3. **Read first:** Read subject fully. Read things it references (other skills, files, configs) to check they exist and resolve.
4. **Look for:**
   - Bugs, errors, contradictions.
   - Ambiguity that causes wrong behavior.
   - Feasibility: can it actually do what it says with tools available.
   - Missing essentials.
   - Clarity, structure, naming.
5. **Don't flag:** Style chosen on purpose. Nitpicks with no real effect.
6. **Report:** Prioritized list: Critical, Should fix, Nice to have. Each item: location, problem in 1–2 sentences, concrete fix. Under ~600 words.
7. **No edits:** Never change subject during review. Present report to user. Ask which fixes to apply.
