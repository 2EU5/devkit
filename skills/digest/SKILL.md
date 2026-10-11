---
name: digest
description: Digest a large plan document (GDD, spec, roadmap) into Linear milestones and issues ready to action, each with intent, acceptance criteria, size and dependencies, created in build order so studio:ship can work them. Also splits one large Linear issue into sub-issues. Use for /studio:digest, or when the user wants a plan or GDD turned into Linear issues.
argument-hint: <doc path, Linear doc or issue ID>
---

# Digest

Break big plan doc into Linear milestones and issues. Each issue small, testable, ready for ship.

Input: $ARGUMENTS

## Mode

- **Doc mode:** input is plan doc (file path, Linear document, URL, pasted text). Doc to milestones and issues.
- **Split mode:** input is one Linear issue ID, or called by ship for L/XL issue. Issue to sub-issues.

## Rules

1. **Read:** Read doc in full. Note sections, "done when" lines, Decided/Proposed/Open tags, risks, non-goals. Missing input: attended, ask; unattended, return "no input" and stop.
2. **Target:** Linear team and project from project CLAUDE.md; else ask user (attended). Read existing milestones and issues first. Never duplicate: matching issue exists, skip it, list it in summary.
3. **Milestones:** Build order, not doc order. Default: prototypes for top risks, core loop, key systems, content, polish. Reuse existing milestones when they fit. Each milestone: name, one-line goal.
4. **Issues:** One unit of work each: one commit's worth, one system or feature slice. Size S, M, L or XL. Split L/XL into S/M where clean split exists.
5. **Issue format** (plain clear English, not caveman):
   - Title: imperative, under ~70 characters ("Add dash with cooldown").
   - **Intent:** why, which pillar or goal it serves, doc section link.
   - **Scope:** what to build.
   - **Acceptance criteria:** checklist, each item testable in Editor. Take from doc's "done when"; keep numbers and (T) marks. `studio:verify` checks these.
   - **Out of scope:** nearby work this issue must not do.
   - **Notes:** Proposed or Open decisions it depends on, flagged.
6. **Fields:** Kind label (`code`, `ui`, `model`, `art`, or own short word). Estimate: match scale as ship rule 11. Status backlog. Unassigned. Milestone set.
7. **Dependencies:** Real blockers only: Linear blocks / blocked-by relation. No relation for loose ordering.
8. **Risks:** Each Open item or risk in doc: prototype issue in earliest milestone. Criteria = question it settles.
9. **Order:** Ship works milestone order, then created date, oldest first. Create milestones in build order. Within milestone, create issues in work order.
10. **Review first (doc mode, attended):** Show breakdown before creating anything: milestones, issues per milestone (title, size, kind), skipped duplicates, Open decisions. User approves or edits. Then create. Unattended (called by ship auto mode): skip review, never ask, create, return summary.
11. **Split mode:** Sub-issues under parent, parent's milestone, status backlog, issue format above, created in work order. Unattended (called by ship): no review, never ask. Create, return sub-issue IDs in order.
12. **Never:** Invent scope doc does not state. Gap needed for issue to make sense: Proposed note on issue. Non-goals and parking lot items: no issues.
13. **Summary:** Plain clear English. Milestones created, issue count per milestone with links, skipped duplicates, Open decisions blocking issues, suggested first issue.
