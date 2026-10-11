---
name: audit
description: Audit a subject (skill, plugin, file, plan, design, doc) and flag issues to correct and improvements to make. Use only for /devkit:audit or when the user explicitly says "audit <subject>". A whole file counts as a subject; a code diff or PR does not (that is code-review).
argument-hint: <subject>
---

# Audit

Check subject. Flag issues to correct, improvements to make.

Subject: $ARGUMENTS

## Rules

1. **Subject:** Resolve subject to concrete files or content before auditing. Not a file (Linear doc, chat text, plan): take its content. No subject given: attended, ask what to audit; unattended (e.g. called by autopilot), never ask: subject and context from caller, none given: return "no subject" and stop.
2. **Auditor:** Spawn one subagent (`Plan` type, read-only; unavailable: `general-purpose`) as auditor. Give it subject (non-file subject: paste content), context from this chat (unattended: caller's issue, acceptance criteria, GDD path), and rules 3–6. Tell it: "You are the auditor. Read only, never edit. Audit inline, spawn no subagents. Return report." Subject over ~5 files or ~1500 lines: split by area across parallel auditors (attended: or ask to narrow), merge reports. Agent tool unavailable (e.g. already running as subagent): audit inline.
3. **Read first:** Read subject fully. Read things it references (other skills, files, configs) to check they exist and resolve.
4. **Look for:**
   - Bugs, errors, contradictions.
   - Ambiguity that causes wrong behavior.
   - Feasibility: can it actually do what it says with tools available.
   - Missing essentials.
   - Clarity, structure, naming.
5. **Don't flag:** Style chosen on purpose. Nitpicks with no real effect.
6. **Report:** Plain clear English, not caveman. Prioritized list: Critical, Should fix, Nice to have. Each item: location, problem in 1–2 sentences, concrete fix. Unattended: tag each item in-scope or out-of-scope for caller's issue. Under ~600 words.
7. **Check findings:** Before presenting or acting, main agent checks each finding against the source. Drop findings that don't hold; downgrade overstated ones; say how many were dropped.
8. **No edits:** Never change subject during audit. Attended: present report, ask which fixes to apply. Running as subagent: return report to main agent, which asks user. Unattended: never ask; return report only.
