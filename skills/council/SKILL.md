---
name: council
description: Stress-test a decision with a fixed council of five advisors (Contrarian, First-Principles Thinker, Expansionist, Outsider, Executor) who argue it out, then synthesize tradeoffs and actionable advice. Use for /council or /studio:council, or when the user says "help me decide between A or B", "should I A or B", or wants a decision, dilemma or conflict stress-tested from several perspectives.
argument-hint: <decision, e.g. between A or B>
---

# Council

Help user make decision. Five fixed advisors judge it independently, then debate. Main agent synthesizes tradeoffs, options, next steps.

Input: $ARGUMENTS

## Council

| Advisor | Lens |
|---------|------|
| **The Contrarian** | Only looks at what will fail. |
| **The First-Principles Thinker** | Rips apart assumptions plan rests on. |
| **The Expansionist** | Finds upside user missing. |
| **The Outsider** | Knows nothing about user's industry. Asks questions insiders stopped asking. |
| **The Executor** | Only cares what user will actually do Monday morning. |

Panel fixed. User asks for other advisors: say panel fixed, proceed.

## Setup

1. **No decision:** reply exactly "Please enter your decision-making dilemma, and I will begin the Council Simulation." Wait.
2. **Context:** Called unattended (e.g. by ship): never ask; take context from caller; return synthesis (choice, reason, rejected options), skip Final Question. Else decision vague: ask 1–3 questions max (stakes, constraints, deadline, current lean and why). Note emotional undertone (fear, guilt, excitement). Advisors address emotion, not only logic.

## Run

Subagents (`general-purpose`), 5 in parallel per round. Separate subagents stop advisors anchoring on each other and drifting into agreement. Agent tool unavailable: role-play rounds inline, write each opening before reading others.

### Round 1: Opening
Each subagent gets decision, context, one advisor with lens, advisor rules. Returns 150–250 words:
- Position: what advisor would do, why.
- Reasoning strictly through advisor's lens.
- Biggest risk advisor sees.
- One question advisor would ask user.

### Round 2: Crossfire
Each subagent gets its advisor, decision, all 5 openings. Returns 100–200 words:
- Strongest disagreement with named advisor(s), with reasoned counterpoint.
- One point conceded, only if lens honestly allows.
- Position changed or not. Default no, unless argument truly moves advisor.

### Advisor rules (give to every subagent)
- Stay strictly in lens. Contrarian never cheerleads. Executor never theorizes.
- No rush to agreement. Disagree where lens demands.
- Thoughtful, rigorous, emotionally balanced. No caricature.
- Read only. No edits.

## Synthesize

Main agent writes final output from both rounds. Never invent consensus. Show where advisors truly split.

## Output

Plain clear English, not caveman. Sections:

### Advisory Panel
Dilemma in 2–3 sentences, with emotional stakes. Council table, one line per advisor on what their lens means for this decision.

### Roundtable
Each opening, condensed, in advisor's voice. Bold one-line position per advisor.

### Crossfire
Key clashes as exchanges: who challenged whom, counterpoint, reply. Note who conceded or shifted.

### Insights and Tradeoffs
- Core tensions (speed vs safety, duty vs desire).
- Where most advisors agree, and lone dissent.
- Risks no advisor could dismiss.

### Synthesis
Options, which advisors back each, cost of each. 2–4 reflection prompts. Executor's Monday-morning steps for leading option. One concrete test that settles biggest uncertainty.

### Final Question
One question user should ask themselves. Always last.

## Notes
- Medical, legal, financial decision: add one line recommending qualified professional.
- Follow-up ("ask Contrarian more", "what would Executor say to that"): spawn only needed subagents. Keep prior rounds as context.
