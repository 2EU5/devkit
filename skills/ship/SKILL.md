---
name: ship
description: Unity C# dev loop. Pulls Linear Backlog issues, implements in Unity Editor, verifies, commits and pushes. Asks the user when it needs them; `/studio:ship auto` never asks and decides itself. `digest` argument, or no issues but a GDD exists, turns the GDD into Linear issues first. Only on explicit /studio:ship.
disable-model-invocation: true
argument-hint: [auto] [digest] [task]
---

# Ship

Unity C# game dev: Linear issue to pushed commit.

## Mode

Leading words, in order, both optional: `auto` = **auto mode**, else **attended mode**. Then `digest` = **digest first** (see Digest). Rest = task.
- **Attended:** user nearby. Work without check-ins; ask only per rule 9.
- **Auto:** user gone. Never ask, never wait for user. Decide yourself (rule 9). Stop only when no workable issue left or a hard blocker (rule 7 push failure, Editor or Linear lost).

## Preflight

Before any work, once. Any check fails: stop, report what is missing.
- Required skills available: `caveman`, `ponytail:ponytail`, `unity:unity-cli`.
- Linear MCP connected.
- Unity Editor connected (Unity MCP or `unity:unity-cli`).
- Auto mode: permission mode auto or bypass, else prompts stall run. Attended: recommended, not required. Check via `mcp__ccd_session_mgmt__get_session` with `self` if available; else proceed, note in summary as unverified.
- `git status` dirty: stop, report.
- `git check-ignore Library/_ Temp/_ Logs/_ UserSettings/_` prints fewer than 4 lines: stop, report (missing Unity .gitignore would commit `Library/`).
- Note current branch. Work commits go there.
- Linear team/project: from project CLAUDE.md; else ask user now. No answer: stop. Mid-loop, ask only per rule 9 (attended mode).
- Team labels missing: create `Needs Input` (#EB5757), `autopilot` (#5E6AD2).

## Digest

After preflight, before `run_start`. Runs when `digest` argument given, or no task given and project has no backlog, unstarted or started issues.
- Find GDD: path in project CLAUDE.md; else Linear project documents; else repo Markdown with "Game Design Document" heading or `GDD` in name. Several: attended, ask; auto, take most recently updated, note in summary.
- No GDD: `digest` argument given: stop, report. Otherwise: report no issues, stop.
- Run `studio:digest` doc mode on GDD. Attended: digest reviews breakdown with user. Auto: digest skips review. Digest skips existing issues, so rerun is safe.
- Then work Queue from created issues.

## Rules

1. **Talk:** Invoke `caveman` skill, args `ultra`, at start. Caveman in chat only. Linear comments, documents, commit messages: plain clear English.
2. **Code:** Invoke `ponytail:ponytail` skill when writing code. Follow Unity best practice: KISS, YAGNI, Single Responsibility.
3. **Editor:** Unity MCP; fallback `unity:unity-cli` skill.
4. **Linear:** Linear user = ship user, so label `autopilot` marks issues ship touched. Issue before work. Pick statuses by type, not name: backlog, unstarted, started, completed. Start: assign self, add label `autopilot`, set started. L/XL issue or design decision: write notes as Linear document attached to issue. Done: acceptance criteria met, verified, pushed; comment what done and `studio:verify` table; set completed.
5. **Queue:** First resume started issues labeled `autopilot`. Then backlog issues, unassigned or assigned to me. Order: milestone first, project order, first to last (no order available: target date, then name). Within milestone: created date, oldest first. Issues without milestone: last, oldest first. Ignore priority. Skip unstarted, triage, label `Needs Input`, others' issues, started issues without `autopilot` (user working on them).
6. **Scope:** No new issues except bugs found while working and L/XL sub-issues. Never expand issue scope. Sub-issues: create with `studio:digest` split mode (status backlog, parent's milestone), work them right after split, complete parent when all done. Bugs: status backlog, no `autopilot` label, comment link on current issue.
7. **Git:** Unit of work = one issue or sub-issue. Commit and push after each, on preflight branch, only after Before commit checks pass. Stage with `git add -A` (gitignore applies). Message: `<ISSUE-ID>: <concise summary>`. Commit `.meta` files with assets. Never commit `Library/`, `Temp/`, `Logs/`, `UserSettings/`, secrets, `.env`, build output. Push rejected: `git pull --rebase`. Rebase conflict: run Push conflict procedure. Push fails for other reason (auth, network): stop run, report. Never force-push. Never rewrite pushed history.
8. **Destructive ops:** Never delete scenes, prefabs, or assets not created this session. Need such deletion: skip it, comment why, keep working. Deletion blocks issue: Abort procedure. Never change `ProjectSettings/` or `Packages/` unless issue requires.
9. **Needs user:** Issue needs user (design, taste or scope decision, playtest, manual Editor work, missing assets).
   - Attended: ask user (AskUserQuestion; options + recommendation), wait, continue with answer, comment it on issue. User says skip or can't do it now: Abort procedure, comment exactly what needed.
   - Auto: decision: run `studio:council`, take its choice, comment choice, reason, rejected options and "decided unattended, revisit if wrong" on issue, continue. Within issue scope only; scope change still never. Only user can do it (playtest, manual Editor work, missing assets, credentials): Abort procedure, comment exactly what needed, move on.
10. **Stuck:** Same issue fails 3 attempts: Abort procedure, comment blocker.
11. **Time limit:** On issue start, assess complexity: S, M, L, XL. Limit: S 30 min, M 1 h, L 2 h, XL 4 h. L/XL: split into sub-issues first if possible (`studio:digest`). Set Linear estimate: t-shirt scale: match by name; other scales: lowest four non-zero values; estimates disabled or scale unknown: skip, size in comment only. Comment size, limit, start time (shell `date`). Elapsed time checked between steps. Keep each step short. Limit exceeded: Abort procedure, comment done, left, cause of overrun, suggested next step or split.
12. **Subagents:** Allowed. Max 5 concurrent. Subagents: code in separate files, research, review. Subagents: no Unity tools, no git, no Linear status changes. Never two agents on same file. Main agent verifies all subagent files, drives Editor, commits. Exception: `studio:council`, `studio:audit` and `code-review` may run their own read-only subagents beyond cap.
13. **Helper skills:** Run `studio:council`, `studio:audit`, `studio:verify` and `studio:digest` unattended in both modes (they never ask; user questions only via rule 9). Exception: Digest section, attended mode, digest reviews breakdown with user. Missing context: take from issue, GDD, code.
    - `studio:council`: real tradeoff in issue scope, 2+ viable options (architecture, approach, library, data layout). Skip trivial choices. Comment choice, reason, rejected options on issue. Design, taste or scope decision: rule 9 instead.
    - `studio:audit`: L/XL issue: audit plan or design notes before code. Fix in-scope findings. Out-of-scope findings: comment on issue.
    - `studio:verify`: every issue, verify phase, before commit. Fail: fix, verify again (counts toward rule 10 attempts). **Needs user** result: rule 9. Paste verify table into done comment.
      Milestone end (last issue of milestone done, next queue issue in other milestone or none): run `studio:verify` milestone mode once on preflight branch. Failure caused by this run's work: fix, commit `<MILESTONE>: fix full-suite failures`, push. Other failures: bug issue per rule 6. Report `step` text `verify milestone`.
    - `studio:digest`: L/XL split (rules 6, 11), split mode.
    - `code-review`: large or risky change: review diff before commit. Fix in-scope findings. Out-of-scope findings: comment on issue.
14. **Progress:** Report to `mcp__studio__status` (tool missing: skip).
    - `run_start`: once, after preflight. `project` = Linear project name. `text` = milestone of first issue (e.g. `M2.5 · Organic world`). `total` = all top-level queue issues at run start. `auto` = true in auto mode, false attended.
    - `issue_start`: issue, title, size, kind. Kind: one word for issue's main work, from labels or content: `code`, `ui`, `model`, `art`; none fits: own short word. Issue in another milestone: `text` = that milestone. Sub-issues added: send updated `total`. Issue not counted at run start (e.g. new bug): send `total` + 1.
    - Sub-issues get own `issue_start` / `issue_done`. Split parent gets `issue_done` once all sub-issues done.
    - `step`: short text on each phase change. Start with phase word (plan, issue kind, verify, commit) so band phase tracker advances. While `council` or `audit` runs, text starts with that word (`audit` also for `code-review`). After they finish, report next phase step before spawning subagents.
    - `issue_done` / `issue_abort`: one-line reason.
    - `run_end`: before final summary, on every exit path (scope done, stop, error).
    - Resumed after interrupt or error (band gone): send `run_start` again, same project, current milestone, same `auto`, `total` = issues left.

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

Task given: do it in the chosen mode. No task: work Queue in the chosen mode. No workable issues left: report summary in chat (done issues, `Needs Input` issues and reason, wip branches), stop.

$ARGUMENTS
