---
name: autopilot
description: Unattended Unity C# dev loop. Pulls Linear Backlog issues, implements in Unity Editor, verifies, commits and pushes. Only on explicit /autopilot.
disable-model-invocation: true
argument-hint: [task]
---

# Autopilot

Autonomous Unity C# game dev.

## Preflight

Before any work, once:
- `git status` dirty: stop, report.
- Note current branch. Work commits go there.
- Editor not connected: stop, report.
- Linear team/project: from project CLAUDE.md; else ask user now. No answer: stop. Never ask mid-loop.
- Linear label `Needs Input` missing: create it (red).

## Rules

1. **Talk:** Invoke `caveman` skill, args `ultra`, at start. Caveman in chat only. Linear comments, commit messages: plain clear English.
2. **Code:** Invoke `ponytail:ponytail` skill when writing code. Follow Unity best practice: KISS, YAGNI, Single Responsibility.
3. **Editor:** Unity MCP; fallback `unity:unity-cli` skill.
4. **Verify:** After code change, check console. Run EditMode/PlayMode tests if present, via running Editor (MCP/CLI); never batchmode while Editor open. Before commit: exit play mode, save scenes and assets, console zero errors. Commit only when clean. Exception: `wip/*` branches.
5. **Linear:** Issue before work. Design notes in Linear documents. Status flow: Backlog, In Progress, Done. Start: assign self, set In Progress. Done: acceptance criteria met, verified, pushed; comment what done and how verified; set Done.
6. **Queue:** Backlog issues, unassigned or assigned to me. Order: priority (Urgent first), then oldest. Own stale In Progress issues: resume first. Skip Todo, Triage, label `Needs Input`, others' issues.
7. **Scope:** No new issues except bugs found while working and L/XL sub-issues. Never expand issue scope.
8. **Git:** Unit of work = one issue or sub-issue. Commit and push after each, on preflight branch. Message: `<ISSUE-ID>: <concise summary>`. Commit `.meta` files with assets. Never commit `Library/`, `Temp/`, `Logs/`, `UserSettings/`, secrets, `.env`, build output. Push rejected: `git pull --rebase`. Conflict: `git rebase --abort`, run Abort procedure. Never force-push. Never rewrite history.
9. **Destructive ops:** Never delete scenes, prefabs, or assets not created this session. Need such deletion: skip it, comment why, keep working. Deletion blocks issue: Abort procedure. Never change `ProjectSettings/` or `Packages/` unless issue requires.
10. **Needs user:** Issue needs user (decision, playtest, manual Editor work, missing assets): Abort procedure, comment exactly what needed.
11. **Stuck:** Same issue fails 3 attempts: Abort procedure, comment blocker.
12. **Time limit:** On issue start, assess complexity: S, M, L, XL. Limit: S 15 min, M 30 min, L 1 h, XL 2 h. L/XL: split into sub-issues first if possible. Set Linear estimate on team scale: S, M, L, XL = lowest four values; estimates disabled: skip. Comment size, limit, start time (shell `date`). Check elapsed time between steps. Limit exceeded: Abort procedure, comment done, left, cause of overrun, suggested next step or split.
13. **Subagents:** Allowed. Max 3 concurrent. Subagents: code in separate files, research, review. Subagents: no Unity tools, no git, no Linear status changes. Never two agents on same file. Main agent verifies all subagent files, drives Editor, commits.

## Abort procedure

Used by rules 8–12.
1. Clean work (compiles, tests pass): commit, push.
2. Else: `git switch -c wip/<ISSUE-ID>`, commit, `git push -u origin wip/<ISSUE-ID>`, switch back to preflight branch.
3. Working tree clean before next issue.
4. Set status Todo. Add label `Needs Input`. Assign issue to user.
5. Comment: what needed or what failed, wip branch if any.
6. Move on.

User clears flag: removes `Needs Input` label, moves issue to Backlog. Issue then available again.

## Run

Args given: do user request autonomously. No args: work Queue autonomously. No workable issues left: report summary in chat (done issues, `Needs Input` issues and reason, wip branches), stop.

$ARGUMENTS
