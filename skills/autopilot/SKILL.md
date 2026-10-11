---
name: autopilot
description: Autonomous Unity C# dev loop. Pulls Linear Backlog issues, implements in Unity Editor, verifies, commits and pushes. Asks the user when it needs them; `/autopilot afk` never asks and decides itself. Only on explicit /autopilot.
disable-model-invocation: true
argument-hint: [afk] [task]
---

# Autopilot

Autonomous Unity C# game dev.

## Mode

First word of arguments `afk`: **afk mode**, rest is the task. Else **attended mode**, all arguments are the task.
- **Attended:** user nearby. Work autonomously; ask only per rule 9.
- **AFK:** user gone. Never ask, never wait for user. Decide yourself (rule 9). Stop only when no workable issue left or a hard blocker (rule 7 push failure, Editor or Linear lost).

## Preflight

Before any work, once. Any check fails: stop, report what missing.
- Required skills available: `caveman`, `ponytail:ponytail`, `unity:unity-cli`.
- Linear MCP connected.
- Unity Editor connected (Unity MCP or `unity:unity-cli`).
- AFK mode: permission mode auto or bypass, else prompts stall the run. Attended: recommended, not required. Check via `mcp__ccd_session_mgmt__get_session` with `self` if available; else proceed, note in summary as unverified.
- `git status` dirty: stop, report.
- `git check-ignore Library/_ Temp/_ Logs/_ UserSettings/_` prints fewer than 4 lines: stop, report (missing Unity .gitignore would commit `Library/`).
- Note current branch. Work commits go there.
- Linear team/project: from project CLAUDE.md; else ask user now. No answer: stop. Mid-loop, ask only per rule 9 (attended mode).
- Team labels missing: create `Needs Input` (#EB5757), `autopilot` (#5E6AD2).

## Rules

1. **Talk:** Invoke `caveman` skill, args `ultra`, at start. Caveman in chat only. Linear comments, documents, commit messages: plain clear English.
2. **Code:** Invoke `ponytail:ponytail` skill when writing code. Follow Unity best practice: KISS, YAGNI, Single Responsibility.
3. **Editor:** Unity MCP; fallback `unity:unity-cli` skill.
4. **Linear:** Linear user = autopilot user, so label `autopilot` marks issues autopilot touched. Issue before work. Pick statuses by type, not name: backlog, unstarted, started, completed. Start: assign self, add label `autopilot`, set started. L/XL issue or design decision: write notes as Linear document attached to issue. Done: acceptance criteria met, verified, pushed; comment what done and how verified; set completed.
5. **Queue:** First resume started issues labeled `autopilot`. Then backlog issues, unassigned or assigned to me. Order: milestone first, project order, first to last (no order available: target date, then name). Within milestone: created date, oldest first. Issues without milestone: last, oldest first. Ignore priority. Skip unstarted, triage, label `Needs Input`, others' issues, started issues without `autopilot` (user working on them).
6. **Scope:** No new issues except bugs found while working and L/XL sub-issues. Never expand issue scope. Sub-issues: status backlog, parent's milestone, work them right after the split, complete parent when all done. Bugs: status backlog, no `autopilot` label, comment link on current issue.
7. **Git:** Unit of work = one issue or sub-issue. Commit and push after each, on preflight branch, only after Before commit checks pass. Stage with `git add -A` (gitignore applies). Message: `<ISSUE-ID>: <concise summary>`. Commit `.meta` files with assets. Never commit `Library/`, `Temp/`, `Logs/`, `UserSettings/`, secrets, `.env`, build output. Push rejected: `git pull --rebase`. Rebase conflict: run Push conflict procedure. Push fails other reason (auth, network): stop run, report. Never force-push. Never rewrite pushed history.
8. **Destructive ops:** Never delete scenes, prefabs, or assets not created this session. Need such deletion: skip it, comment why, keep working. Deletion blocks issue: Abort procedure. Never change `ProjectSettings/` or `Packages/` unless issue requires.
9. **Needs user:** Issue needs user (design, taste or scope decision, playtest, manual Editor work, missing assets).
   - Attended: ask user (AskUserQuestion; options + recommendation), wait, continue with answer, comment it on issue. User says skip or can't do it now: Abort procedure, comment exactly what needed.
   - AFK: decision: run `devkit:decide`, take its choice, comment choice, reason, rejected options and "decided unattended, revisit if wrong" on issue, continue. Within issue scope only; scope change still never. Only user can do it (playtest, manual Editor work, missing assets, credentials): Abort procedure, comment exactly what needed, move on.
10. **Stuck:** Same issue fails 3 attempts: Abort procedure, comment blocker.
11. **Time limit:** On issue start, assess complexity: S, M, L, XL. Limit: S 30 min, M 1 h, L 2 h, XL 4 h. L/XL: split into sub-issues first if possible. Set Linear estimate: t-shirt scale: match by name; other scales: lowest four non-zero values; estimates disabled or scale unknown: skip, size in comment only. Comment size, limit, start time (shell `date`). Elapsed time checked between steps, so keep each step short. Limit exceeded: Abort procedure, comment done, left, cause of overrun, suggested next step or split.
12. **Subagents:** Allowed. Max 5 concurrent. Subagents: code in separate files, research, review. Subagents: no Unity tools, no git, no Linear status changes. Never two agents on same file. Main agent verifies all subagent files, drives Editor, commits. Exception: `devkit:decide`, `devkit:audit` and `code-review` may run their own read-only subagents beyond cap.
13. **Helper skills:** Run `devkit:decide` and `devkit:audit` unattended in both modes (they never ask; user questions only via rule 9). Missing context: take from issue, GDD, code.
    - `devkit:decide`: real tradeoff in issue scope, 2+ viable options (architecture, approach, library, data layout). Skip trivial choices. Comment choice, reason, rejected options on issue. Design, taste or scope decision: rule 9 instead.
    - `devkit:audit`: L/XL issue: audit plan or design notes before code. Fix in-scope findings. Out-of-scope findings: comment on issue.
    - `code-review`: large or risky change: review diff before commit. Fix in-scope findings. Out-of-scope findings: comment on issue.
14. **Progress:** Report to `mcp__devkit__status` (tool missing: skip). `run_start` once, after preflight: `project` = Linear project name, `text` = milestone of first issue (e.g. `M2.5 · Organic world`), `total` = all top-level queue issues at run start; sub-issues added later: send updated `total` with their `issue_start`. `issue_start` whose issue is in another milestone: `text` = that milestone. Sub-issues get their own `issue_start` / `issue_done`; split parent gets `issue_done` once all its sub-issues are done. Queue picks up an issue not counted at run start (e.g. a new bug): send `total` + 1 with its `issue_start`. `issue_start` with issue, title, size, kind. Kind: one word for the issue's main work, from its labels or content: `code`, `ui`, `model`, `art`; none fits: own short word. `step` with short text on each phase change, starting with the phase word (plan, the issue's kind, verify, commit) so the band's phase tracker advances; text starts `decide` or `audit` while those skills run (`audit` also for `code-review`); after they finish, report the next phase step before spawning subagents. `issue_done` / `issue_abort` with one-line reason. `run_end` before final summary, on every exit path (scope done, stop, error). Resumed after interrupt or error (band gone): send `run_start` again, same project and current milestone, `total` = issues left.

## Before commit, branch switch, reset or rebase

Exit play mode, save scenes and assets.
- Commit: console zero errors. Commit only when clean. Exception: `wip/*` branches.
- Branch switch, reset or rebase (incl. `git pull --rebase`): after, wait for Editor reimport, check console. Errors after rebase: fix before push.

## Push conflict procedure

Used by rule 7. Local commit never reached remote, so moving it is allowed.
1. `git rebase --abort`.
2. `git branch <wip>`, `git push -u origin <wip>`. `<wip>` = `wip/<ISSUE-ID>`; exists locally or on remote: `wip/<ISSUE-ID>-2`, `-3`, …
3. `git reset --hard origin/<preflight branch>`. Only allowed reset: unpushed commits of this session, already saved on wip branch.
4. Abort procedure from step 4.

## Abort procedure

Used by rules 7–11. Attended mode, rule 9: only after user says skip.
1. Clean work (compiles, console zero errors): commit, push. Push conflict: Push conflict procedure, stop here.
2. Else (see Before commit, branch switch, reset or rebase): `git switch -c <wip>` (name as Push conflict step 2), `git add -A`, commit, `git push -u origin <wip>`, switch back to preflight branch.
3. Working tree clean before next issue.
4. Set status unstarted (Todo). Add label `Needs Input`. Keep assignee.
5. Comment: what needed or what failed, wip branch if any.
6. Move on.

User clears flag: removes `Needs Input` label, moves issue to Backlog. Issue then available again.

## Run

Task given: do it autonomously, in the chosen mode. No task: work Queue autonomously. No workable issues left: report summary in chat (done issues, `Needs Input` issues and reason, wip branches), stop.

$ARGUMENTS
