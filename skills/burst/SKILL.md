---
name: burst
description: Make N distinct options for a creative or strategic subject (logos, names, taglines, copy, layouts, ideas, plans), score each on a goal-based rubric, pick a winner + next step. Use for /burst or /studio:burst, or "N versions", "bunch of options", "variations", "alternatives" of creative or strategic work, or many ideas generated and compared to pick the best. Not for code variants.
argument-hint: <count> <subject> [goal or notes]
---

# Burst

Make a set of distinct options, test each against the user's goal, and pick a winner.

Input: $ARGUMENTS

## 1. Read the request

Usage: `/studio:burst <count> <subject> [goal or notes]`
- `/studio:burst 10 logo redesign`
- `/studio:burst 5 taglines for the Christmas catalogue — goal: drive repeat orders`
- `/studio:burst 8 names for the evolution sim`

- **Count**: the first number. Default 6. Above 15, work in rounds of 10 or fewer, all in one reply. Grade every version in one table and pick one winner overall.
- **Subject**: everything after the count. An attached file, image or recently discussed output is the source material.
- **Goal**: take it from the request, the conversation or what you know about the user and their business. If there is no goal:
  - If a wrong guess would waste a lot of work, ask one short question with 2–3 likely goals.
  - Otherwise infer the most likely goal, state it in one line at the top ("Grading against: …"), and proceed.

## 2. Set the rubric first

Before generating, turn the goal into **4–6 criteria scored /10**. Base them on how the work will be used, not on general taste. Examples:
- **Logo**: small/embroidered legibility, one-colour reproduction, recognition vs the old version, distinctiveness, range of uses.
- **Name**: memorability, says what it is, available/ownable, sounds right aloud, fits the audience. Score availability only after checking (web search); otherwise mark it `?` and say so.
- **Copy**: clarity, persuasion toward the goal, brand voice, length fit, stands out from competitors.

Define each criterion in a few words so the scores mean something.

## 3. Generate independent versions

Each version must come from a **different core idea**, not a tweak of another.
- First list `count` distinct angles. Mix literal, metaphorical, minimal, playful, premium and bold. Include one deliberately risky option.
- Build each version from its own angle. Do not reuse devices from other versions.
- Self-check: if two versions share the same one-line idea, replace one.
- Give each version a short, memorable name ("Ink Hyphen", "The Stack").
- Use real content. No lorem ipsum, invented stats or placeholder brands. Keep the user's real name, colours and facts unless dropping them is the point of that version (say so).

## 4. Grade honestly

Score every version on every criterion in a table:

| # | Name (one-line idea) | C1 | C2 | … | **Total** |

Put a key under the table: C1 = …, C2 = ….

- Use the whole scale. Do not cluster scores at 7–8. A striking idea can lose if it fails the goal.
- Score what was made, not what it could become.
- Ties: break on the criterion closest to the goal.

## 5. Deliver in the right format

- **Visual work** (logos, posters, layouts, UI): show the versions side by side, one card per version with its score in the title. Use a design canvas (Design artifact type) if available; otherwise one HTML/SVG artifact or widget with a grid of cards; otherwise inline SVG. Stress-test only the top 3, with tests that match the rubric (logos: full colour, reversed, one colour small).
- **Text work** (names, taglines, copy, ideas, plans): present inline, numbered, each with its name and content.

## 6. Pick the winner

- **Strongest**: name it. Give 3–5 sentences on why it best serves the goal, tied to the criteria.
- **Its weakness**: one honest line.
- **Combination**: if a runner-up fixes the winner's weakness, suggest combining them (e.g. "#2 as the main logo, #1's icon as the secondary mark").
- **Why the losers lost**: one sentence per group of versions with the same flaw.
- **Next step**: offer one concrete refinement of the winner.

## Rules

- Variety beats polish. Ten different rough ideas beat ten polished versions of one idea.
- Keep the goal visible. Every score traces back to it.
- Keep the reply tight: goal line, versions, table, winner, next step. Do not recap the process.
