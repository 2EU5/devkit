---
name: autopilot
description: Unattended Unity C# dev loop. Pulls Linear Backlog issues, implements in Unity Editor, verifies, commits and pushes. Requires auto or bypass permission mode. Only on explicit /autopilot.
disable-model-invocation: true
argument-hint: [task]
---

# Autopilot

Autonomous Unity C# game dev.

## Preflight

Before any work, once. Any check fails: stop, report what missing.
- Required skills available: `caveman`, `ponytail:ponytail`, `unity:unity-cli`.
- Linear MCP connected.
- Unity Editor connected (Unity MCP or `unity:unity-cli`).
- Permission mode auto or bypass. Else prompts stall unattended run.
- `git status` dirty: stop, report.
- Note current branch. Work commits go there.
- Linear team/project: from project CLAUDE.md; else ask user now. No answer: stop. Never ask mid-loop.
- Team labels missing: create `Needs Input` (#EB5757), `autopilot` (#5E6AD2).

## Rules

1. **Talk:** Invoke `caveman` skill, args `ultra`, at start. Caveman in chat only. Linear comments, documents, commit messages: plain clear English.
2. **Code:** Invoke `ponytail:ponytail` skill when writing code. Follow Unity best practice: KISS, YAGNI, Single Responsibility.
3. **Editor:** Unity MCP; fallback `unity:unity-cli` skill.
4. **Linear:** Linear user = autopilot user, so label `autopilot` marks issues autopilot touched. Issue before work. Pick statuses by type, not name: backlog, unstarted, started, completed. Start: assign self, add label `autopilot`, set started. L/XL issue or design decision: write notes as Linear document attached to issue. Done: acceptance criteria met, verified, pushed; comment what done and how verified; set completed.
5. **Queue:** First resume started issues labeled `autopilot`. Then backlog issues, unassigned or assigned to me. Order: priority (Urgent first), then oldest. Skip unstarted, triage, label `Needs Input`, others' issues, started issues without `autopilot` (user working on them).
6. **Scope:** No new issues except bugs found while working and L/XL sub-issues. Never expand issue scope.
7. **Git:** Unit of work = one issue or sub-issue. Commit and push after each, on preflight branch, only after Before commit checks pass. Stage with `git add -A` (gitignore applies). Message: `<ISSUE-ID>: <concise summary>`. Commit `.meta` files with assets. Never commit `Library/`, `Temp/`, `Logs/`, `UserSettings/`, secrets, `.env`, build output. Push rejected: `git pull --rebase`. Rebase conflict: run Push conflict procedure. Push fails other reason (auth, network): stop run, report. Never force-push. Never rewrite pushed history.
8. **Destructive ops:** Never delete scenes, prefabs, or assets not created this session. Need such deletion: skip it, comment why, keep working. Deletion blocks issue: Abort procedure. Never change `ProjectSettings/` or `Packages/` unless issue requires.
9. **Needs user:** Issue needs user (decision, playtest, manual Editor work, missing assets): Abort procedure, comment exactly what needed.
10. **Stuck:** Same issue fails 3 attempts: Abort procedure, comment blocker.
11. **Time limit:** On issue start, assess complexity: S, M, L, XL. Limit: S 15 min, M 30 min, L 1 h, XL 2 h. L/XL: split into sub-issues first if possible. Set Linear estimate: t-shirt scale: match by name; other scales: lowest four non-zero values; estimates disabled or scale unknown: skip, size in comment only. Comment size, limit, start time (shell `date`). Elapsed time checked between steps, so keep each step short. Limit exceeded: Abort procedure, comment done, left, cause of overrun, suggested next step or split.
12. **Subagents:** Allowed. Max 3 concurrent. Subagents: code in separate files, research, review. Subagents: no Unity tools, no git, no Linear status changes. Never two agents on same file. Main agent verifies all subagent files, drives Editor, commits. Exception: `devkit:decide` and `devkit:audit` may run their own read-only subagents beyond cap.
13. **Helper skills:** Run `devkit:decide` and `devkit:audit` unattended. Never ask user questions. Missing context: take from issue, GDD, code.
    - `devkit:decide`: real tradeoff in issue scope, 2+ viable options (architecture, approach, library, data layout). Skip trivial choices. Comment choice, reason, rejected options on issue. Design, taste or scope decision: rule 9 instead.
    - `devkit:audit`: L/XL issue: audit plan or design notes before code. Large or risky change: audit diff before commit. Fix in-scope findings. Out-of-scope findings: comment on issue.
14. **Progress:** Report to `mcp__devkit__status` (tool missing: skip). `run_start` after preflight, `text` = scope (milestone), `total` = issues in scope. `issue_start` with issue, title, size. `step` with short text on each phase change, starting with the phase word (plan, code, verify, commit) so the band's phase tracker advances; text starts `decide` or `audit` while those skills run. `issue_done` / `issue_abort` with one-line reason. `run_end` before final summary.

## Before commit, branch switch or reset

Exit play mode, save scenes and assets.
- Commit: console zero errors. Commit only when clean. Exception: `wip/*` branches.
- Branch switch or reset: after, wait for Editor reimport, check console.

## Push conflict procedure

Used by rule 7. Local commit never reached remote, so moving it is allowed.
1. `git rebase --abort`.
2. `git branch wip/<ISSUE-ID>`, `git push -u origin wip/<ISSUE-ID>`.
3. `git reset --hard origin/<preflight branch>`. Only allowed reset: unpushed commits of this session, already saved on wip branch.
4. Abort procedure from step 4.

## Abort procedure

Used by rules 7–11.
1. Clean work (compiles, console zero errors): commit, push. Push conflict: Push conflict procedure, stop here.
2. Else (see Before commit, branch switch or reset): `git switch -c wip/<ISSUE-ID>`, `git add -A`, commit, `git push -u origin wip/<ISSUE-ID>`, switch back to preflight branch.
3. Working tree clean before next issue.
4. Set status unstarted (Todo). Add label `Needs Input`. Keep assignee.
5. Comment: what needed or what failed, wip branch if any.
6. Move on.

User clears flag: removes `Needs Input` label, moves issue to Backlog. Issue then available again.

## Run

Args given: do user request autonomously. No args: work Queue autonomously. No workable issues left: report summary in chat (done issues, `Needs Input` issues and reason, wip branches), stop.

$ARGUMENTS
