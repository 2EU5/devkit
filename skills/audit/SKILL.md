---
name: audit
description: Review a subject (skill, plugin, file, plan, design, doc) and flag issues to correct and improvements to make. Use for /devkit:audit, or when the user says "audit <subject>" or "review <subject>" (not a code diff). For reviewing a code diff or PR, use code-review instead.
argument-hint: <subject>
---

# Audit

Check subject. Flag issues to correct, improvements to make.

Subject: $ARGUMENTS

## Rules

1. **Subject:** No subject given: ask what to review. Resolve subject to concrete files/things before review.
2. **Reviewer:** Spawn one subagent (`general-purpose`) for review. Give it subject, context from this chat, and these rules. Subagent reads only, never edits. Agent tool unavailable (e.g. already running as subagent): review inline.
3. **Read first:** Read subject fully. Read things it references (other skills, files, configs) to check they exist and resolve.
4. **Look for:**
   - Bugs, errors, contradictions.
   - Ambiguity that causes wrong behavior.
   - Feasibility: can it actually do what it says with tools available.
   - Missing essentials.
   - Clarity, structure, naming.
5. **Don't flag:** Style chosen on purpose. Nitpicks with no real effect.
6. **Report:** Prioritized list: Critical, Should fix, Nice to have. Each item: location, problem in 1–2 sentences, concrete fix. Under ~600 words.
7. **No edits:** Never change subject during review. Present report to user. Ask which fixes to apply. Running as subagent: return report to main agent, which asks user. Called unattended (e.g. by autopilot): never ask; return report only.
