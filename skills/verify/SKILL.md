---
name: verify
description: Verify Unity work against acceptance criteria in the running Editor. Runs EditMode and PlayMode tests, checks the console in and out of play mode, captures Game view screenshots for visual work, and maps every criterion to a pass or fail with evidence. Use for /studio:verify, or when the user asks to verify, check or test a Unity change in the Editor.
argument-hint: [issue ID or criteria]
---

# Verify

Prove Unity change meets acceptance criteria. Evidence per criterion, not "looks fine".

Input: $ARGUMENTS

## Rules

1. **Criteria:** Linear issue ID given: take acceptance criteria from issue. Criteria text given: use it. Neither: attended, derive from current change, confirm with user; unattended (called by ship), take from caller, none given: return "no criteria" and stop.
2. **Editor:** Unity MCP; fallback `unity:unity-cli` skill. Run inline, main agent only. No subagents (they get no Unity tools).
3. **Prepare:** Exit play mode. Save scenes and assets. Wait for compile and reimport.
4. **Compile:** Console zero errors after compile. Errors: fail, stop, report them.
5. **Tests:** Targeted, never whole suite by default.
   - Run only tests covering the change: filter by changed scripts' assembly, namespace, class or test name. EditMode first, then PlayMode, each filtered.
   - Exclude slow tests: categories `Slow`, `Long`, `Stress`, `Soak`, `Performance`, `Integration`; tests over ~60 s in last results file (Test Runner XML) or earlier run this session.
   - Budget: ~5 min total test time per verify. Filtered set over budget: run narrowest subset, list skipped tests in report.
   - **Milestone mode:** caller says milestone end, or user asks: run full suite, slow tests included, no budget, no criteria needed (rule 1 skipped; report = test results and console). Only then. Criteria naming slow test: run that test only.
   - Never rerun passing tests. Failing test: rerun once max to rule out flake.
   - No tests cover change, or project has no tests: note it, continue. New logic with no test: say so in report.
   - Never delete or skip failing test to pass.
6. **Play:** Criterion about runtime behavior: enter play mode, exercise it (load scene, trigger action via MCP or test hook), watch console during play. Exit play mode after.
7. **Visual:** Criterion about UI, art, layout or feel: capture Game view screenshot per state. Attach or reference in report. Taste judgment (looks good, feels right): mark **needs user**, never pass it yourself.
8. **Map:** Each criterion gets one result: **pass**, **fail** or **needs user**. Each with evidence: test name, console line, screenshot, observed value.
9. **No fixes:** Verify only. Never edit code during verify. Fail: report cause if known. Caller fixes, then verifies again.
10. **Report:** Plain clear English, not caveman. Table: criterion, result, evidence. Then console summary (errors and warnings new in this change), test counts, gaps (untested logic, unverifiable criteria). Called by ship: return report. Ship pastes table into issue done comment.
