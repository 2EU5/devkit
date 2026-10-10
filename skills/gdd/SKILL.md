---
name: gdd
description: Interview the user about a game idea, then write a clear, detailed game design document (GDD). Use for /gdd, or when someone wants a GDD, a game design doc, or help turning a game concept into a design. Also updates an existing GDD.
argument-hint: [game idea or existing GDD]
---

# GDD

Turn game idea into GDD people use. GDD not full description of game in advance. GDD is tool for consistent decisions about game nobody can fully see yet. All rules follow from this.

Five phases: calibrate, interview, recap, write, check. Never skip interview, even when first message detailed. Short gap-fill round beats guessing.

Input: $ARGUMENTS

## Doc principles

1. **Sharp vision first.** Pitch paragraph, target player experience, 3–5 pillars, core loop: all before system detail. Each pillar must be able to kill a feature. "Satisfying combat" can't. "Every fight can be avoided" can.
2. **Intent with instructions.** Each feature: problem it solves, experience it serves, then how it works. The why lets readers fill gaps and shows what is safe to cut.
3. **Layered.** One-page overview, readable in 10 min. Then one section per system. Then detail. Reader stops at needed depth.
4. **Short, visual.** Length tracks complexity and risk, not enthusiasm. Tables, Mermaid flow/state diagrams, loop diagrams, annotated layouts where they beat prose.
5. **Concrete, testable.** Real numbers marked tunable. Worked examples. Edge cases. "Done when" per feature. Reference games as shorthand ("closer to X than Y"). One term per thing, defined in glossary.
6. **Player's side.** What player sees, decides, feels, not only machinery. Always include first-session walkthrough.
7. **Honest uncertainty.** Tag each decision **Decided**, **Proposed** or **Open**. List open questions, assumptions, risks, each with prototype or test that settles it.
8. **Explicit scope.** Non-goals. Must/should/could. Parking lot for good ideas not for this version.
9. **Alive, second to build.** Sections have owners and last-updated dates. Playable build is source of truth. Stale doc is bug.
10. **Decision log.** What, when, why, rejected alternatives.

## Phase 1: Calibrate (one short round)

Ask:
- **Team:** solo, small (2–10), larger. Sets doc weight.
- **Stage:** raw idea, prototype exists, production underway.
- **Purpose:** own thinking, align team, pitch to publisher/funder, onboard collaborators.
- **Existing material:** notes, pitch, old docs, build. If any: read first, ask only about gaps.

Scale doc:
- **Solo / raw idea:** lean. Vision, pillars, loop, first-session walkthrough, scope, decision log carry weight. System specs brief.
- **Small team:** full system sections with owners and "done when".
- **Larger team or pitch:** full structure, tighter terms, more visuals. Pitch: overview and references matter most.

## Phase 2: Interview

### How
- **2–4 related questions per round.** Never wall of 20. Multiple-choice answers (genre, camera, platform, session length, team size): use AskUserQuestion tool if available. Vision and feel: open questions.
- **Offer drafts to react to.** Proposal easier than blank page. Example: "Pillar might be 'Every run tells a story.' Keep, change, drop?"
- **Push back on vagueness.** Pillar rules nothing out: ask what feature it kills. Answer is "fun": ask what moment makes player grin.
- **Ask for references.** "Which games is this closest to, and how is it different from each?"
- **Accept "not sure", "you decide".** "Not sure" = **Open**. "You decide" = Claude proposes, tagged **Proposed**, never Decided.
- **Follow energy.** More questions on systems user is excited or worried about. Fewer on standard ones.
- Keep running internal list: answers, contradictions, open items.

### Cover (roughly in order)
1. **Pitch.** One sentence. Player fantasy (who player is, what they get to do). Genre, camera, perspective.
2. **Experience.** Feel moment to moment and at session end. Target audience. Reference games, with difference from each.
3. **Pillars.** Draft 3–5 together. Test each: "what does this rule out?"
4. **Core loop.** What player does every 30 s, every session, across whole game. What brings them back.
5. **Key systems.** Per system: intent, how it works, player inputs and feedback, rough numbers, failure and edge cases. Start with 2–4 systems that make game *this* game.
6. **Progression, content.** How game changes over time: levels, unlocks, difficulty curve, rough content amount, game length.
7. **First session.** First 10–15 min from launch: what player sees, does, learns, in order.
8. **World, story, tone** (if relevant). Setting, narrative delivery, art direction, audio mood.
9. **Platform, controls.** Platforms, input, session length, engine and tech constraints, monetisation if any.
10. **Scope.** Non-goals, must/should/could, parked ideas, rough timeline or milestones.
11. **Risks.** Most likely not to work or not fun. Technically hardest. What to prototype first.
12. **Decisions made.** Choices made, alternatives considered, why.

Stop when vision, pillars, core loop, key systems clear enough to write. Unknowns become Open items, not more rounds. Typical: 5–8 rounds.

## Phase 3: Recap

Send compact recap: pitch, pillars, core loop in one line, systems list, scope headline, top 3 open questions. Flag contradictions. User confirms or corrects. Then write.

## Phase 4: Write

### Rules
- **Never present invention as decided.** Anything user didn't say: **Proposed**.
- Mark tunable numbers **(T)**, e.g. "Dash cooldown: 1.5 s (T)".
- Use user's own words. Define each term once in glossary. No synonyms for same thing.
- Structured content: table, list or diagram over paragraph.
- Each system section opens with intent, ends with "done when".
- Section not applicable: "N/A" in one line, or drop. No padding.
- Doc text: plain clear English, not caveman.

### Template

```markdown
# <Game title>: Game Design Document
Version <x.y> · Last updated <date> · Owner <name>
Status key: Decided · Proposed · Open · (T) = tunable number

## 1. Overview (the one-pager)
- **Pitch:** one sentence.
- **Player fantasy:** who you are and what you get to do.
- **Genre / camera / platforms / session length:**
- **Target player:**
- **References:** <Game A> for <aspect>, but <difference>; <Game B> for ...
- **Design pillars:** 3–5, each with one line on what it rules out.
- **Core loop:** diagram (Mermaid) plus one line per step.
- **What this game is not:** the top non-goals.

## 2. Player experience
Target emotions, moment to moment and per session. What a great session feels like.

## 3. First-session walkthrough
A numbered beat-by-beat walkthrough of the first 10–15 minutes: what the player sees, does, learns and feels at each beat.

## 4. Systems
### 4.x <System name>  (Owner · Status · Last updated)
- **Intent:** the problem it solves and the experience it serves. Which pillar it supports.
- **How it works:** rules, as concise as possible.
- **Player view:** inputs, feedback, UI.
- **Numbers:** table of values, with (T) where tunable.
- **Examples and edge cases:** worked example(s), plus "what happens when ...".
- **Interactions:** which other systems it touches.
- **Done when:** testable criteria.
- **Open questions:**

## 5. Progression and content
The difficulty curve, unlocks, content list and estimated playtime. Use a table or chart.

## 6. World, narrative and tone
Setting, story delivery, art direction (with reference images or descriptions) and audio direction.

## 7. Controls and UX
Control map table, main screens and their flow (diagram), accessibility notes.

## 8. Technical notes
Engine, platforms, performance targets, known constraints.

## 9. Scope
- **Must / Should / Could** table.
- **Non-goals.**
- **Parking lot:** good ideas not for this version.
- **Milestones** (if known).

## 10. Risks, assumptions and open questions
Table with columns: Item · Type (risk/assumption/question) · Impact · How we'll settle it (prototype/test) · Status

## 11. Decision log
Table with columns: Date · Decision · Why · Alternatives rejected

## 12. Glossary
One entry per term, one definition each.
```

## Phase 5: Check, deliver

Check doc against list. Fix failures:
- [ ] Newcomer reads only section 1: can say what game is and isn't?
- [ ] Every pillar rules something out?
- [ ] Every system: intent, pillar served, "done when"?
- [ ] Every interview number present, tunable ones marked (T)?
- [ ] Everything Claude invented tagged Proposed? Nothing user left open shown as Decided?
- [ ] Every open item in section 10, with way to settle it?
- [ ] Each term consistent, defined in glossary?
- [ ] Structured passages turned into tables or diagrams?
- [ ] Padding, repetition, generic filler cut?
- [ ] Nothing contradicts user, or current build if one exists?

**Output format:** session offers document artifact type (e.g. Docs): create GDD there, so user can edit, comment, export. Else write Markdown file and send it. User asks specific format (.docx, Notion, Google Doc): use that.

After delivery: one-line summary, one natural next step, usually prototype that settles biggest open risk. Linear connected: offer to turn open questions and prototypes into issues.

## Update existing GDD

1. Read in full. Ask what changed: playtest results, new decisions, cuts.
2. Change only affected sections. Bump version and last-updated dates.
3. Decision log entry per change, with reason.
4. Move settled Open items to Decided. Add new risks.
5. Re-run Phase 5 checklist on changed sections.
