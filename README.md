# devkit

Claude Code plugin for game dev workflows.

| Skill | Command | What it does |
|-------|---------|--------------|
| autopilot | `/devkit:autopilot [task]` | Unattended Unity C# loop: takes Linear Backlog issues, implements them in the Unity Editor, verifies, commits and pushes. |
| design | `/devkit:design [idea or GDD]` | Interviews you about a game idea, then writes or updates a game design document. |
| audit | `/devkit:audit <subject>` | Reviews a skill, plan, design or doc and gives a prioritized fix list. |
| decide | `/devkit:decide <decision>` or "help me decide between A or B" | Stress-tests a decision with a fixed council (Contrarian, First-Principles Thinker, Expansionist, Outsider, Executor) who debate it, then synthesizes tradeoffs and next steps. |
| handoff | `/devkit:handoff [next focus]` | Compacts the current conversation into a handoff doc in your OS temp folder so a fresh session can pick up the work. |

## Install

```
/plugin marketplace add 2EU5/devkit
/plugin install devkit@devkit
```

## Autopilot requirements

Autopilot checks all of these at startup and stops if any is missing.

- **Skills:** `caveman`, `ponytail:ponytail` (ponytail plugin), `unity:unity-cli` (Unity plugin).
- **Linear MCP** connected.
- **Unity Editor** open and reachable through a Unity MCP server or the Unity CLI.
- **Permission mode** auto or bypass, so permission prompts don't stall the run.
- **Clean git working tree** with an `origin` remote. Work is committed to the branch that's checked out.
- **Linear team/project** named in the project's `CLAUDE.md` (otherwise autopilot asks once at startup).

### Linear setup

- Autopilot creates team labels `Needs Input` and `autopilot` if missing.
- It works Backlog issues that are unassigned or assigned to you, milestone by milestone in project order, oldest first within each milestone; issues without a milestone go last. Statuses are picked by type (backlog / unstarted / started / completed), so custom names are fine.
- Because the Linear MCP acts as you, the `autopilot` label marks issues autopilot started. Started issues without it are left alone.

### Progress UI

While autopilot runs, devkit shows its progress in a bordered band above the prompt: a header with the project and run time; the milestone with a run progress bar (when the issue total is known) and done / needs-input counts; the current issue with size and title; a plan → work → verify → commit phase tracker, its work phase named by the issue's kind (code, ui, model, art, …), with the current step and the time on the issue; and a footer with running subagents, tool calls, files touched and commits for the issue, the last result and total tokens. Both timers tick each second. Toasts fire when an issue finishes or needs input. It also enforces the 5-subagent cap at spawn time. The band is fed by the skill calling `mcp__devkit__status`; a run ends on `run_end`, when you stop the main loop, or after 4.5 h with no progress report.

### When an issue needs you

Autopilot sets the issue to Todo, adds `Needs Input`, comments what it needs, and pushes any partial work to `wip/<ISSUE-ID>`. To hand it back, remove the `Needs Input` label and move the issue to Backlog.

## License

[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/): free to use and share with credit. No commercial use. No sharing modified versions. See [LICENSE](LICENSE).
