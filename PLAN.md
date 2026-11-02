# Patchline: Cal Hacks 13.0 Build Plan

Oct 24, 2026 · @Ed

## Build status (kept up to date by whoever is building)

| Phase | State | Notes |
| --- | --- | --- |
| 0 Setup + mocked skeleton | done | `USE_MOCKS=1 pnpm dev`; `pnpm e2e` runs report → merged for both bugs offline |
| 1 Game, replay, history | done (not deployed) | `pnpm make-history`, `pnpm check:game` all pass; Vercel deploy needs a GitHub repo |
| 2 Ingest + triage | done (mock Claude, mock Jira) | 30 reports → 4 clusters, injection quarantined |
| 3 Repro, bisect, verify | done | replay path + 3-way race, bisect in ~5–12 s |
| 4 Droid fix + merge | code done, needs keys | DroidFixAgent written against SDK v0.10 examples; mock fix agent proves the loop |
| 5 Dashboard + Forge | dashboard done; Forge written, not deployed | needs `forge register` + tunnel |
| 6 Tournament, breaker, baseline, voice | done | voice uses browser STT + Cartesia TTS (fallback speechSynthesis) |
| 7 Showcase + README | README done; showcase needs Apify token | `pnpm showcase:fetch` |
| 8 Freeze, rehearse, record | not started | |

## How to use this plan with Claude Code

Export this doc as Markdown, save it as PLAN.md at the repo root, and start Claude Code with: "Read PLAN.md fully. Implement it phase by phase, starting at Phase 0. Stop at the end of each phase and show me what passes its Done-when check."

Working rules for Claude Code:

1. Mocks first. Every external service (Claude, Droid, Apify, Cartesia, Jira, SpacetimeDB, Discord) sits behind a TypeScript interface with a Mock* implementation. The whole pipeline must run end to end with USE_MOCKS=1 before any real key is wired in.
2. Never invent an API. For Factory Droid SDK, SpacetimeDB, Cartesia and Forge, read the current docs or the sponsor starter pack before writing calls. If unsure of a method name, stop and ask instead of guessing.
3. No secrets in the repo. All keys come from .env (gitignored); commit only .env.example. Cartesia and other judges require this.
4. Deterministic over clever. Anything that decides truth (replay, repro pass/fail, bisect, verify) is plain code. LLMs only read messy text and draft code.
5. Enforce permissions in code, not in prompts. Each agent gets only the tools listed in its row of the permissions table.
6. Log every agent action to the audit_event table with inputs, outputs and reasoning. The dashboard and the Forge panel both read from it.
7. Small commits, phase by phase. Each phase ends with a demoable state; never leave main broken after Saturday 6 PM.
8. Explain as you go. Summarize each file's role in one line when you create it, so every teammate can answer judge questions.
9. Rule check: all code is written during the event (started Fri Oct 23). No pre-existing project code is reused.

## Overview

Patchline is an AI QA team for indie game studios: it turns player complaints into a reproduced bug, the exact commit that caused it, and a verified fix a human approves. Working name; rename freely.

**Pitch (one line):** "Every AI debugger guesses. Ours proves it: reproduce the bug from a player's complaint, find the commit that broke it, and only show you fixes that pass."

**Named community:** solo and small indie devs shipping on Steam, whose bug reports land in a Discord, Steam reviews or Reddit they don't have time to read. The engine is source-agnostic, so the pitch closes with "and it scales to AAA launch volume."

What makes it more than a wrapper:

- Deterministic replay: a seeded game sim plus input logs, so any session replays exactly.
- Repro harness: a bug is only "confirmed" when a generated test reproduces it.
- Auto-bisect: git bisect run finds the culprit commit with no LLM involved.
- Verify gate: a fix is shown only if the repro test and the full suite pass.
- Least-privilege agents: agents that read untrusted text can never write code.

## Target tracks

| Track | What we show them | Must-have for eligibility |
| --- | --- | --- |
| Atlassian (Track 1) | Agents create and update Jira issues; Forge issue panel shows the agent trace; Forge trigger starts the fix pipeline | Forge app on a demo site, 3-minute max demo video, repo link |
| Factory Droid SDK | Droid runs on a trigger (issue labeled), scoped to culprit files, plan and diff visible | README section explaining where and how Droid is used |
| Anthropic | Named community, lived problem, Claude for triage and repro drafting, known failure modes | Clear statement of where Claude can go wrong |
| Cartesia | Voice brief and voice approval ("approve the fix") | 2-minute demo-first pitch, README with Cartesia features and limits |
| SpacetimeDB | Live shared state for reports, agent runs, fix tournament | Spacetime is the core backend, not a side store |
| Apify | Scraper agent over real Steam reviews and Reddit posts (showcase) | Meaningful use; consider building a custom actor for the Best Actor award |
| Most Technically Complex (general) | Replay, bisect, tournament, verify gate | Live demo |

Optional if time allows: Atlassian Track 2 framing (injection quarantine plus audit and rollback), Moss (memory), Elastic (search over reports). Drop Meta; it does not fit this project.

## Track requirements in full

Summarized from the Cal Hacks 13.0 hacker guide and the Atlassian challenge doc. Check the live site Saturday for updates.

**Cal Hacks general (applies to every track)**

- Submit on Devpost by 9:00 AM Sunday; late projects are not judged.
- Whole team present at the assigned table for 10:30 AM to 12:30 PM; a live demo is required.
- Project started during the event; follow the MLH Code of Conduct; teams of 1 to 4.
- Judged on impact, quality, technical complexity and creativity.

**Atlassian: Agentic Workforce Challenge**

- Build a Forge app for Jira or Confluence; pick Track 1 (agents that do the work) or Track 2 (security for agents acting for users). We enter Track 1 and show Track 2 ideas as a bonus.
- Setup: Node 22 or 24, Forge CLI 14+, an API token with Forge scopes, a demo site via forge site provision.
- Devpost must include a demo video of 3 minutes or less and the repo link.
- Criteria: creativity and quality of the idea; usefulness and impact for Atlassian users; technical implementation, including use of Forge and Atlassian APIs and robustness.
- They favor projects that leave the team with less work, not more. Help: @Vanya Rohatgi in #spons-atlassian on Slack.
- Covered by: spec 10 (Jira REST, Forge issue panel, Forge trigger) and the recorded video in Phase 8.

**Factory: Best Use of the Droid SDK**

- Use the Droid SDK (TypeScript or Python) meaningfully; Droid must do real work in the running product.
- README must explain where and how Droid is used.
- Scores well: Droid runs on a trigger you designed; thoughtful limits on what it can touch; its plans, steps, diffs and results are visible.
- Scores poorly: a chatbot wrapper, slides-only demos, or not being able to tell what the agent did.
- Covered by: spec 7 (label trigger, file allowlist, scope check, tournament) and the dashboard diff viewer.

**Anthropic**

- A named community, narrower than "students."
- A real problem you have lived or heard from someone who has.
- It works: one thing done well and usable on Monday.
- Thoughtful use of Claude: it matters to the solution, and you know where it could go wrong for users.
- Covered by: indie studios without QA, the Blipzz experience, and the "Where can Claude go wrong?" answer in the judge prep.

**Cartesia**

- Voice must be core to the product; make clear what Cartesia contributes.
- Submit a working demo, a 2-minute demo-first presentation (one full user flow, then problem and build), a short README (setup, Cartesia features used, known limitations), and source access with no keys in the repo.
- Criteria, 25% each: problem and originality; use of Cartesia (clear, responsive, natural voice); execution and edge cases; impact and responsibility (accessibility, privacy, responsible use).
- They favor a strong working prototype over a big unfinished idea.
- Covered by: spec 12 (hands-free brief, confirmed voice approval, no player names read aloud). Voice is the weakest fit here; it is cut item 5 if time runs short.

**SpacetimeDB**

- SpacetimeDB must be the core real-time backend, used meaningfully rather than on the side.
- Good fits they name: AI agent coordination in a persistent world state, live dashboards, shared ops dashboards.
- Covered by: every table in the data model and the live agent lanes on the dashboard.

**Apify**

- Use Apify meaningfully; prizes for the top 5 projects.
- A separate Best Actor award goes to an actor built for this event.
- Covered by: spec 13 showcase; the custom game-feedback-collector actor targets Best Actor.

**Most Technically Complex (general prize)**

- No separate criteria beyond general judging; replay, bisect, tournament and the verify gate carry it.

## Hard constraints

- Devpost submission by Sun Oct 25, 9:00 AM; aim for a draft by Sat 10 PM.
- Judging 10:30 AM to 12:30 PM Sunday; whole team at the table; live demo required.
- Teams of 1 to 4. All code started during the event.
- Venue wifi may be unreliable: every live step needs a recorded or replayable fallback.

## Architecture

One TypeScript monorepo runs the agents and dashboard; the demo game lives in its own repo so its git history stays clean for bisect. Reports flow through the zones top to bottom; only the bottom zone can write code, on scoped branches, behind a human approval.

### Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript, Node 22, pnpm workspaces | Forge requires Node 22 or 24 |
| Demo game | Vite + Canvas, separate repo patchline-demo-game, deployed on Vercel | Pure sim module, no DOM in game logic |
| Orchestrator | Node + Fastify, in-process job queue (p-queue) | Webhooks, approve endpoint, event bus |
| Shared state | SpacetimeDB | Server module language per current docs; TS client SDK. Fallback: Convex if setup blocks more than 1 hour |
| Dashboard + voice | React + Vite; /voice route is the phone view | Live subscriptions to SpacetimeDB |
| LLM | Anthropic SDK, model name from ANTHROPIC_MODEL env var | Triage, repro drafting, breaker tests |
| Fix agent | Factory Droid SDK (TypeScript) | Fallback ClaudeFixAgent behind the same interface |
| Tests | Vitest, run headless against the sim | Repro tests are plain Vitest files |
| Jira | Jira REST API from the orchestrator + Forge app | Forge: issue panel + event trigger |
| Sources | Discord bot (discord.js), in-game report endpoint, apify-client | Steam/Reddit via Apify for the showcase |
| Voice | Cartesia TTS; speech input via browser Web Speech API or Cartesia STT if available | Check Cartesia docs for current STT |

### Repo layout (planned)

```
patchline/
  PLAN.md
  .env.example
  packages/
    core/            # shared types: Report, Cluster, AgentRun, FixCandidate; interfaces for every service
    orchestrator/    # Fastify server, event bus, pipeline state machine
      agents/
        intake.ts    # dedupe + cluster (Claude)
        repro.ts     # report -> Vitest repro test (Claude), runs race
        bisect.ts    # git bisect run (deterministic)
        fix.ts       # Droid runner, tournament
        breaker.ts   # adversarial edge-case tests (Claude)
        verify.ts    # runs suites, scores candidates (deterministic)
        scraper.ts   # Apify showcase
        baseline.ts  # naive single-loop agent, sandbox only, for the injection demo
      sources/       # adapters: ingame, discord, apify, fixture
      services/      # real + mock clients: claude, droid, jira, cartesia, spacetime
      policy/        # capability tokens + injection quarantine
    dashboard/       # React app: board, issue view, diff viewer, demo controls, /voice
    spacetime/       # SpacetimeDB module (schema + reducers)
    forge-app/       # Atlassian Forge app (manifest.yml, issue panel, trigger)
  fixtures/          # saved scraped reviews, seeded Discord posts, replays
patchline-demo-game/ # separate repo, deployed to Vercel
```

As built, the demo game repo is generated at `../hop-runner` (the game is called Hop Runner); push it to GitHub under any name.

### Agents and permissions

Permissions are enforced by passing each agent only the tool functions in its row; nothing else is importable from its module.

| Agent | Job | Reads | Writes | LLM? |
| --- | --- | --- | --- | --- |
| Source adapters | Normalize input into Report | Raw Discord, in-game, Apify data | report rows | No |
| Quarantine | Flag instruction-like text, strip it before any LLM sees it | report | report.quarantined, quarantine rows | Claude classifier + regex |
| Intake | Dedupe, cluster, extract repro steps as JSON | Sanitized reports only | cluster, Jira issue create/update | Claude |
| Repro (x3 in race) | Turn steps or a replay into a failing Vitest test | Cluster summary, sim API docs | Files in a sandbox worktree only | Claude |
| Bisect | Find the first bad commit | Game repo (read), repro test | pipeline.culprit_commit | No |
| Fix (x2 in tournament) | Patch the bug | Culprit diff, failing test, scoped files | A branch per candidate, scoped files only | Droid |
| Breaker | Write edge-case tests to break each fix | Candidate diff, sim API | Test files in sandbox | Claude |
| Verifier | Run repro + suite + breaker tests, score | Candidate branches | fix_candidate scores | No |
| Merger | Merge winner after human approval | Approved candidate | main of game repo | No |
| Baseline (demo only) | Naive loop with every tool | Everything | A throwaway sandbox clone, never pushed | Claude |

### Data model (SpacetimeDB tables)

| Table | Key fields | Written by |
| --- | --- | --- |
| report | id, source, author, text, created_at, game_version, replay_id?, quarantined, cluster_id? | Adapters, quarantine, intake |
| cluster | id, title, summary, repro_steps_json, report_count, first_seen, last_seen, jira_key, severity | Intake |
| pipeline | cluster_id, stage, culprit_commit?, winner_candidate_id?, updated_at | Orchestrator |
| agent_run | id, agent, cluster_id, status, started_at, ended_at, summary | Every agent |
| repro_attempt | id, cluster_id, interpretation, test_path, result | Repro |
| fix_candidate | id, cluster_id, branch, diff, repro_pass, suite_pass, breaker_pass_count, diff_lines, score | Fix, verifier |
| audit_event | id, agent_run_id, action, inputs_json, output_json, reasoning, reversible | Every agent |
| quarantine | id, report_id, matched_text, reason | Quarantine |

Pipeline stages, in order: reported → clustered → reproducing → confirmed → bisecting → culprit_found → fixing → verifying → awaiting_approval → merged, plus not_reproducible and escalated exits.

## Component specs

Each spec lists what to build and the Done-when check Claude Code must pass before moving on.

### 1. Demo game (patchline-demo-game)

A tiny browser endless runner: jump obstacles, collect coins, score climbs.

- Pure sim module src/sim.ts: createState(seed), step(state, input): state at a fixed 60 Hz, seeded RNG (mulberry32). No DOM, no Date.now(), no Math.random() in game logic.
- Replay API: runReplay({ seed, startState?, inputs }) → { finalState, error? }, where inputs is one bitmask per frame (jump, duck, pause).
- Invariants assertInvariants(state): positions are finite numbers, score never decreases, player stays in bounds. Violations throw a named error such as InvariantError('score_decreased').
- Input recorder: ring buffer of the last 1,800 frames (30 s), plus a state snapshot at the buffer start.
- In-game "Report bug" button: text box, then POST /reports with text, seed, snapshot, inputs, and the build's commit SHA.
- Replay viewer: ?replay=<id> plays a stored replay in the canvas.
- Baseline test suite: about 10 Vitest tests that pass on every commit.
- Planted bugs, each introduced in its own commit by scripts/make-history.sh, buried among about 12 realistic commits:

| Bug | Planted change | Symptom | Report type in demo |
| --- | --- | --- | --- |
| Score reset | "refactor scoring" wraps score at 256 | Score drops to near zero after 255 | In-game report with replay (live judge demo) |
| Pause-jump freeze | Jump velocity divided by dt, which is 0 while paused | Position becomes NaN, game freezes | Text-only Discord post (repro race) |
| Tunneling (stretch) | Collision checked only at frame end | Obstacles pass through player at high speed | Seeded Steam-style text |

Done when: runReplay gives identical results on 100 repeated runs; each bug reproduces from a hand-written test; the bug commits are mid-history.

### 2. Source adapters (orchestrator/sources)

All sources produce the same Report type from core.

- ingame: Fastify POST /reports, stores the replay blob, returns an id.
- discord: discord.js bot reads #bug-reports, replies "Tracking as PATCH-12" with the Jira link, and later replies "Fixed in <sha>" when merged. This closes the loop with players.
- apify: pulls dataset items from Apify runs (Steam reviews, Reddit) into fixtures/ and into report.
- fixture: replays saved JSON on a timer; powers demo mode.

Done when: one command (pnpm seed:demo) fills the board with 30 mixed reports from fixtures.

### 3. Quarantine (orchestrator/policy)

- Runs on every report before any LLM agent sees it.
- Regex pass for instruction-like text ("ignore previous", "system:", "push to main", shell commands, URLs to unknown hosts), then a Claude classifier call that only returns { suspicious: boolean, reason }.
- Suspicious text is cut out and stored in quarantine; the report continues with the cleaned text.

Done when: the seeded injection post lands in quarantine and its instructions never appear in any later prompt.

### 4. Intake agent

- Input: sanitized reports plus current cluster titles and summaries.
- Claude returns JSON, validated with zod: { is_bug, cluster_id | "new", title, summary, repro_steps[], platform, version, severity }.
- New cluster creates a Jira issue (label needs-repro); existing cluster increments report_count and adds a Jira comment.

Done when: the 30 seeded reports collapse into the expected 3 to 5 clusters with correct Jira issues.

### 5. Repro agents (race)

- With a replay: no LLM. Generate a Vitest test from a template that calls runReplay and expects the invariant error.
- Text only: Claude drafts 3 different interpretations of the steps, each as a Vitest test that scripts inputs against the sim API. All 3 run in parallel; 60 s timeout each.
- Validity rule: a repro counts only if it fails on HEAD with the expected invariant error and passes on the oldest good commit. This rejects tests that fail from syntax errors.
- No winner after 2 rounds: stage not_reproducible, and the Discord bot asks the reporter one clarifying question.

Done when: the pause-jump text report is confirmed by at least one of the 3 racers, and the board shows the losers failing.

### 6. Bisect worker

- Temp git worktree of the game repo; git bisect start HEAD <good>, where good is the oldest commit or last release tag.
- git bisect run pnpm vitest run <repro test>; exit code 125 skips commits that do not build.
- Parse the first bad commit; store SHA, message, author, and its diff.

Done when: both planted bugs bisect to their exact commits in under 30 s.

### 7. Fix agents (Droid tournament)

- Trigger: stage reaches culprit_found and the Jira issue has label agent-fixable (a human adds it, or auto-add for the demo).
- Two Droid runs in parallel with different instructions: "smallest change that makes the test pass" and "fix the root cause in the culprit change."
- Inputs: failing test path, culprit diff, allowlist = files touched by the culprit commit.
- Each run works on its own branch fix/<cluster>/<n> in its own worktree.
- Scope check after each run: reject the candidate if it touches files outside the allowlist or edits any test file.
- Check the Factory Droid SDK docs and starter pack for the real API before writing this. Keep a ClaudeFixAgent fallback behind the same FixAgent interface.

Done when: two candidates appear for the score-reset bug with plans and diffs visible on the board.

### 8. Breaker agent

- Per candidate, Claude writes 3 to 5 edge-case tests near the bug (for score: exactly 255, 256, 511; for pause: pause on frame 0, jump during unpause).
- A breaker test is kept only if it passes on the oldest good commit; otherwise it is wrong, not the fix.

Done when: at least one breaker test fails on a deliberately bad candidate.

### 9. Verifier and merger

- Gates: repro test passes, full suite passes. Then rank by breaker tests passed (high first), then diff size (small first).
- Winner: stage awaiting_approval; Jira comment with summary; voice notification.
- Approval from the dashboard button, the voice command, or a Jira transition merges the branch to main and pushes; Vercel redeploys.

Done when: approving merges, redeploys, and the replay test passes against the live build.

### 10. Jira and Forge app (forge-app)

- Orchestrator calls Jira REST (create issue, comment, label, transition) on the demo site from forge site provision.
- Forge issue panel: shows stage, culprit commit, candidate scores, diffs, and the audit trail, fetched from the orchestrator. Declare the orchestrator host under external fetch permissions in manifest.yml; expose it via a tunnel (for example cloudflared) or a small deploy.
- Forge trigger on issue updates: when label agent-fixable is added, call the orchestrator webhook to start the fix stage. Check the Jira event list in the Forge docs for exact event names.
- Watch Forge function time limits: Forge only forwards events; all long work runs in the orchestrator.

Done when: adding the label in Jira starts the Droid tournament, and the panel updates as it runs.

### 11. Dashboard (dashboard)

- Board: columns by pipeline stage with cluster cards (report count, severity, Jira key).
- Agent lanes: live agent_run rows; the repro race and fix tournament render side by side with pass/fail.
- Issue view: source reports, replay link, repro tests, bisect result, candidates with diff viewer and scores, Approve button.
- Audit log: every audit_event; per-action rollback buttons (stretch).
- Demo controls: seed reports, post injection, toggle baseline vs Patchline, reset state, pre-warm fix.

Done when: a teammate across the table can follow a bug from report to merge on the big screen without narration.

### 12. Voice (/voice)

- "What's new?": orchestrator builds a 20-second brief from current state with Claude; Cartesia TTS plays it.
- Commands parsed by Claude into intents: approve, assign, details, repeat.
- approve always asks for confirmation ("Approving the score-reset fix. Say yes to confirm.").
- Never read player names or usernames aloud.

Done when: the full approve flow works by voice on a phone over venue wifi.

### 13. Apify showcase

- Apify actors pull public Steam reviews of one popular indie game and matching Reddit posts; save to fixtures/ once.
- Run intake clustering only (no repro, since we have no repo for that game) and show "2,000 reviews into N clusters."
- Stretch for the Best Actor award: publish your own small actor, game-feedback-collector, that normalizes reviews and posts into the Report shape.
- Public data only; hide usernames in the UI.

### 14. Injection demo (baseline.ts)

- Seeded Discord post with planted instructions, for example asking the agent to push to main and print the .env.
- The baseline agent gets raw text and every tool, but runs only in a throwaway clone with no real remote. Show it attempting the push.
- Patchline: quarantine flags the post; intake only sees the cleaned text; and no agent that reads report text has code or git tools anyway.

Done when: the side-by-side runs on one button press in demo controls.

## Build plan

The real core loop (report, repro, bisect, Droid fix, verify, merge) must work by Saturday 5 PM; everything after that is stacking tracks and polish. Times assume a team of 4 with sleep in shifts.

Roles: A = agents and orchestrator · B = game, replay, bisect, verify · C = Droid, Jira, Forge · D = dashboard, voice, demo, pitch. With 2 people: A+B and C+D. Solo: follow the cut list from the top.

### Phase 0 · Setup and mocked skeleton (Sat 12:45 to 2:30 AM, everyone)

- [ ] Get keys into .env: Anthropic, Factory, Apify, Cartesia, SpacetimeDB, Discord bot, GitHub, Vercel, Jira API token.
- [ ] Forge: npm i -g @forge/cli@latest, forge login, forge site provision, forge register.
- [x] Scaffold the monorepo and the separate game repo; core types and every service interface with a mock.
- [x] Pipeline state machine running on fake data; dashboard shows cards moving through stages.

Done when: USE_MOCKS=1 pnpm dev shows a fake bug travel from reported to merged on the board.

### Phase 1 · Game, replay, history (Sat 2:30 to 10 AM, B; others sleep in shifts)

- [x] Pure sim, seeded RNG, invariants, input recorder, report button, replay viewer.
- [x] Baseline test suite; make-history.sh plants the score-reset and pause-jump bugs mid-history.
- [ ] Deploy to Vercel; [x] SpacetimeDB module with all tables (A, in parallel).

Done when: component spec 1 checks pass and the live game posts a report with a replay.

### Phase 2 · Ingest and triage (Sat 10 AM to 1 PM, A)

- [x] Adapters (in-game, Discord, fixture), quarantine, intake agent, Jira issue creation.
- [x] pnpm seed:demo with 30 fixture reports including one injection post.

Done when: seeded reports become 3 to 5 clusters with Jira issues; the injection post sits in quarantine.

### Phase 3 · Repro, bisect, verify (Sat 11 AM to 2 PM, B)

- [x] Replay-path repro first (no LLM), then the 3-way text repro race.
- [x] Bisect worker; verify gate tested with a hand-written fix.

Done when: both planted bugs are confirmed and bisected to the right commit automatically.

### Phase 4 · Droid fix and merge (Sat 1 to 5 PM, C)

- [ ] Attend the Factory workshop; wire one real Droid run behind FixAgent with scope check.
- [x] Approve endpoint merges (and pushes when GAME_REPO_PUSH=1); [ ] Vercel redeploys.

Milestone, Sat 5 PM: judge-style run works for real: play, report, confirmed, culprit found, Droid fix, verified, approved, redeployed, bug gone.

### Phase 5 · Dashboard and Forge (Sat 3 to 8 PM, D and C)

- [x] Dashboard on live data: board, agent lanes, issue view, diff viewer, demo controls. [ ] Switch to direct SpacetimeDB subscription.
- [ ] Forge issue panel and agent-fixable trigger (code written); tunnel to the orchestrator.

Done when: component specs 10 and 11 checks pass.

### Phase 6 · Multi-agent and safety stack (Sat 6 to 10 PM, A and C)

- [x] Fix tournament (2 runs) and breaker agent.
- [x] Baseline agent and the one-button injection side-by-side.
- [x] Voice page with brief and confirmed approve (D).

### Phase 7 · Showcase and submission draft (Sat 8 to 10 PM, D)

- [ ] Apify showcase over real Steam and Reddit data, saved to fixtures (`pnpm showcase:fetch`).
- [x] README with sections for Factory (where Droid runs), Cartesia (features and limits), Atlassian, Apify, setup steps.
- [ ] Devpost draft submitted by 10 PM with teammates added.

### Phase 8 · Freeze, rehearse, record (Sat midnight to Sun 9 AM)

- [ ] Feature freeze at midnight; bug bash only after that.
- [ ] Demo mode button replays seeded events with no waiting.
- [ ] Record the 3-minute Atlassian video, which doubles as the wifi-failure fallback.
- [ ] Rehearse the 2-minute pitch at least 3 times; each teammate answers the judge questions in the next section.
- [ ] Final Devpost submit by 9:00 AM Sunday; at the table by 10:30 AM.

### Cut list (cut from the top when behind)

1. Tunneling bug
2. Audit rollback buttons
3. Custom Apify actor
4. Breaker agent
5. Voice speech input (keep TTS brief, approve by button)
6. Fix tournament (single Droid run)
7. Forge trigger (start fixes from the dashboard; keep the issue panel)

Never cut: replay, repro, bisect, verify gate, one real Droid run, Jira issues, the live board.

### Workshops worth one person each

Factory Droid SDK (C), SpacetimeDB (A), Apify (D), Anthropic Claude Code (anyone). Times are on the live site and the app.

## Demo and submission

The demo's job is one moment: a judge reports a bug and watches it get proven, traced to a commit, and fixed in about 90 seconds.

### 2-minute script

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 | Board with real Steam reviews clustered | "A 3-person studio wakes up to this. No QA team." |
| 0:15 | Judge scans QR, plays, hits score reset, taps Report | "Report it however you'd complain." |
| 0:35 | Card moves: confirmed by replay, bisect names the culprit commit | "Proven, not guessed. Here's the exact commit." |
| 0:55 | Two Droid candidates, breaker attacks, one goes green | "Agents compete; only the fix that survives gets shown." |
| 1:15 | "Approve" by voice, redeploy, judge refreshes, bug gone | "One word from the developer." |
| 1:35 | Injection button: baseline obeys, Patchline quarantines | "Agents that read the internet can't touch your code." |
| 1:50 | Jira issue with Forge panel | "It all lives where the team already works." |

Also keep the pause-jump Discord post ready for judges who ask about text-only reports; it shows the 3-way repro race.

### Fallbacks

- Slow Droid run: a pre-warmed candidate from a run 20 minutes earlier, shown with its log; say so honestly.
- Wifi down: play the recorded video; run the orchestrator, SpacetimeDB and game locally on one laptop with a phone hotspot.
- API rate limit or outage: USE_MOCKS=1 replays the last real run's recorded outputs.
- Voice fails: Approve button on the dashboard.

### Judge questions to rehearse

- "Isn't this just an agent in a loop?" Permissions, persistent state, deterministic proof (replay, bisect, verify), and the injection demo.
- "Where can Claude go wrong?" Misclustering two bugs together; drafting repro tests that fail for the wrong reason (blocked by the validity rule); over-trusting player text (blocked by quarantine).
- "Does it work on a real game?" The engine needs a deterministic sim or a replay; text-only reports still go through the repro race. Unity and Godot support is future work.
- "What's real vs simulated?" Real: game, replays, bisect, Droid, Jira, Steam data. Simulated: the player community on Discord.
- "Why multi-agent?" Least privilege, the repro race, and the fix tournament each beat a single agent.

### Submission checklist

- [ ] Devpost: description, track selections (Atlassian, Factory, Anthropic, Cartesia, SpacetimeDB, Apify, Most Technically Complex), all teammates added.
- [ ] Atlassian demo video, 3 minutes max, linked on Devpost.
- [ ] Public repo link; no keys in history (scan with git log -p | grep -i key before publishing).
- [ ] README: setup, architecture, where Droid runs, Cartesia features and limits, Apify usage, known limitations.
- [ ] Final submit by 9:00 AM Sunday.
- [ ] Return rented hardware (none planned) by 2 PM Sunday.

### Top risks

| Risk | Mitigation |
| --- | --- |
| Droid SDK API differs from what we expect | Factory workshop early Saturday; ClaudeFixAgent fallback behind the same interface |
| SpacetimeDB setup eats hours | Time-box to 1 hour; switch to Convex with the same table shapes |
| Forge tunnel or permissions issues | Orchestrator calls Jira REST directly; Forge panel is additive |
| Repro race finds nothing for vague text | Replay path is the live demo; text race is the secondary story |
| Team burnout | Sleep shifts in Phase 1; feature freeze at midnight |
