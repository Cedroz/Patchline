# Patchline

**An AI QA team for solo and small indie game devs.** Patchline turns player complaints into a reproduced bug, the exact commit that caused it, and a verified fix that a human approves.

> Every AI debugger guesses. Ours proves it: reproduce the bug from a player's complaint, find the commit that broke it, and only show you fixes that pass.

Built at Cal Hacks 13.0 for solo and small indie devs shipping on Steam, whose bug reports land in a Discord, Steam reviews or Reddit they don't have time to read.

## What makes it more than a wrapper

| Piece | Decides truth? | LLM? |
| --- | --- | --- |
| **Deterministic replay**: seeded sim + per-frame input log; any session replays exactly | yes | no |
| **Repro harness**: a bug is "confirmed" only when a test fails on `main` with the expected invariant **and** passes on the oldest good commit | yes | drafts only |
| **Auto-bisect**: `git bisect run` names the culprit commit | yes | no |
| **Fix tournament**: two fix-agent runs (Droid) on separate branches, scoped to the culprit's files | no | Droid |
| **Breaker agent**: adversarial edge-case tests; kept only if they pass on the good commit | no | Claude |
| **Verify gate**: repro + full suite must pass; rank by breakers survived, then smaller diff | yes | no |
| **Least privilege**: agents that read untrusted text hold no code or git tools (enforced in code) | yes | no |

## Quick start (no keys needed)

```bash
pnpm install
pnpm make-history                 # builds ../hop-runner, the demo game, with 2 planted bugs mid-history
pnpm --dir ../hop-runner install
pnpm check:game                   # spec 1 checks: determinism, repros, bisect finds both culprits
cp .env.example .env              # USE_MOCKS=1 by default
pnpm dev                          # orchestrator :8787, dashboard :5173, game :5174
```

Open http://localhost:5173 and click **Seed 30 reports**. Or open the game at http://localhost:5174, play past 255 points, and hit **Report bug**. Approve the winning fix from the issue drawer.

- `pnpm e2e`: the whole loop in-process on a disposable clone (report → merge for both bugs, about 50 s with mocks).
- `pnpm test`: unit tests for the policy, quarantine, scope check and ranking.
- `pnpm seed:demo`: seeds a running orchestrator from the command line.
- **Reset** in the dashboard clears state and moves the game's `main` back to the generated history. It only does this if Patchline's own merges are the only commits on top.

With `USE_MOCKS=1`, every external service uses its mock, and the mock Claude answers deterministically (`services/mock-brain.ts`). **The deterministic parts still run for real** even in mock mode: replay, vitest in git worktrees, bisect, scope check, verify gate and merge. Real Claude answers are recorded to `fixtures/recordings/`, and the mock replays them when the prompt matches.

## Architecture

```
patchline/
  packages/core/          shared row types + one interface per external service
  packages/orchestrator/  Fastify API, pipeline state machine, agents, policy, real + mock services
    src/agents/           intake, repro (race), bisect, fix (tournament), breaker, verify, merger, baseline, scraper, voice
    src/policy/           capability grants (toolkit per agent) + injection quarantine
    src/game/             git worktrees, headless vitest, bisect-step, test templates
    src/services/         llm (Claude), fix-agents (Droid/Claude/mock), jira, chat (Discord), voice (Cartesia), scraper (Apify)
    src/store/            in-memory store + SpacetimeDB write-through mirror
  packages/dashboard/     React dashboard: bug list, voice panel, agent activity, issue drawer
  packages/spacetime/     SpacetimeDB module (tables + reducers)
  packages/forge-app/     Atlassian Forge app: Jira issue panel + issue-updated trigger
  game-base/              clean source of the demo game; scripts/make-game-history.mjs builds its repo
  fixtures/               demo reports, the score-reset replay, hand-written repros, recordings
```

Pipeline stages: `reported → clustered → reproducing → confirmed → bisecting → culprit_found → fixing → verifying → awaiting_approval → merged`, with exits `not_reproducible` and `escalated`. Every agent action writes an `audit_event` row with its inputs, output and reasoning. The dashboard and the Forge panel both read from it.

### Agents and permissions (enforced in `policy/capabilities.ts`)

Each agent receives `toolkit(agent, ALL_TOOLS)`: an object that contains only its granted functions. The orchestrator refuses to boot if an agent that reads player text (quarantine, intake, repro, scraper) is ever granted a code or git tool.

| Agent | Tools |
| --- | --- |
| quarantine | `llm_json` (classifier may only answer `{suspicious, reason}`) |
| intake | `llm_json`, `jira_create`, `jira_comment` |
| repro | `llm_json`, sandbox worktree / write test (`__repro__/*.test.ts` only) / run tests |
| bisect | `repo_read`, `sandbox_bisect` |
| fix | `sandbox_branch`, `fix_agent`, `sandbox_commit`, `sandbox_diff`, run tests |
| breaker | `llm_json`, sandbox write/run tests |
| verify | sandbox write/run tests |
| merger | `repo_merge`, `repo_revert`, `repo_push`, Jira comment/transition, chat reply. Runs **only** after a human approves or asks for a revert |
| docs | `llm_json`, `jira_comment`. Writes the bug write-up from verified facts; no code or git tools |
| baseline (demo) | everything, but only against a throwaway clone with its remote removed and a fake `.env` |

## Factory Droid: where and how Droid runs

- **Trigger:** a cluster reaches `culprit_found` and its Jira issue has the `agent-fixable` label. A human adds it (the Forge trigger forwards it), or the demo adds it automatically (`AUTO_AGENT_FIXABLE=1`). The dashboard's **Run fix** button does the same thing.
- **What runs:** `packages/orchestrator/src/services/fix-agents.ts` → `DroidFixAgent`. It uses `createSession` from `@factory/droid-sdk/node`, with `cwd` set to a dedicated git worktree on branch `fix/<cluster>/<n>`. Two sessions run in parallel with different instructions: "smallest change" and "root cause in the culprit change".
- **Limits on what it can touch:** `autonomyLevel: Off` routes every tool use through our `permissionHandler`. It allows edits and creates **only** to files touched by the culprit commit (the bisect result), and commands **only** to run vitest. Everything else is cancelled and logged as `[permission] DENY`. After the run, `scopeCheck` checks the git diff again: any file outside the allowlist or any test file rejects the candidate.
- **Visible:** each candidate's plan, streamed steps (assistant text, tool calls, permission decisions), diff, gate results and score appear live on the dashboard. The Forge panel shows the same.
- **Edit, test, repeat:** each worktree links the game's `node_modules` (a junction on Windows, unlinked before the worktree is removed), so Droid runs the repro itself: it watches it fail, edits, and reruns until it passes. The verify gate then reruns everything independently.
- `ClaudeFixAgent` (Anthropic API, writes whole files within the allowlist) and `MockFixAgent` sit behind the same `FixAgent` interface (`FIX_AGENT=droid|claude|mock`).
- **Permission handler** (`autonomyLevel: Off`, so every action asks): edits and patches only to files in the culprit commit's allowlist; commands only the vitest repro/suite or read-only git (`git status|diff|log|show`, also as `git -C <its own worktree>`), with chaining (`&&`, `;`, `|`) and `--output` (which writes a file) refused. The rules live in `commandAllowed` and are unit-tested in `policy.test.ts`. Script batches are checked call by call, against the full command line (`fullCommand`). Reads need no permission. A refusal ends the run, so the prompt states these rules up front. Every allow/deny decision is logged to the candidate's trace on the board.
- Needs the `droid` CLI plus `FACTORY_API_KEY`. On Windows the npm `droid` is a `.cmd` shim the SDK can't spawn, so the agent resolves the native `droid.exe` from the CLI package (override with `DROID_EXEC_PATH`). Check it with `pnpm droid:smoke`: one real Droid run on the score-reset bug in a throwaway clone, then the scope check, the repro and the full suite.

## Anthropic: how Claude is used, and where it can go wrong

Claude reads messy text and drafts code. It never decides truth.

- **Intake** (`agents/intake.ts`): clusters reports and extracts repro steps as zod-validated JSON (structured outputs via `client.beta.messages.parse`, model from `ANTHROPIC_MODEL`, server-side refusal fallback enabled).
- **Repro race** (`agents/repro.ts`): three interpretations of a text-only report, each written as a Vitest test.
- **Docs** (`agents/docs.ts`): once a fix is verified, writes the plain-English write-up (what happens, impact, root cause, the fix, how we know, risk) from the repro, bisect and verify results, and posts it to Jira. The dashboard labels this prose "Claude" and shows the facts it rests on, labeled "verified", next to it.
- **Breaker** (`agents/breaker.ts`), **quarantine classifier**, **voice brief and intents**.

Where it can go wrong for users:

1. **It can merge two different bugs into one cluster, or split one bug in two.** Splits are caught in plain code: two clusters whose repros bisect to the same commit and break the same invariant are merged as duplicates. A wrong merge shows up as a failed repro or a strange culprit. Performance and platform complaints are marked not testable in the sim, so drafters never force them into some other bug.
2. **It can write repro tests that fail for the wrong reason** (syntax errors, a nonexistent API). These are blocked by the validity rule: a test must fail on `main` with the *expected* `InvariantError` and pass on the good commit. The demo race shows one draft rejected exactly this way.
3. **It can trust player text too much.** Quarantine cuts instruction-like spans before any LLM sees them, and no agent that reads player text holds code tools.
4. **It can write a fix that hides the symptom.** The breaker tests and the verify gate catch it. In the demo, the "clamp at 255" fix passes the repro but fails all 3 breakers and loses.

## Cartesia: voice

- The **Voice** panel on the dashboard (works on a phone too). **"What's new?"** gives a ~20-second brief, built by Claude from live state and spoken with **Cartesia TTS** (`POST /tts/bytes`, `sonic-3.6`, mp3). Commands are parsed by Claude into intents: `approve`, `details`, `repeat`, `brief`, `cancel`.
- **Approve always needs confirmation:** "Approving the fix for X. Say yes to confirm." Only a spoken or tapped "yes" merges.
- **Responsible use:** player names, handles and emails are scrubbed before text reaches TTS (`scrubNames`). Only bug titles and stages are spoken.
- **Limits:** speech input uses the browser Web Speech API, which needs HTTPS (use the tunnel URL) and is unsupported in some browsers; the page falls back to typed input. If Cartesia fails, the page falls back to `speechSynthesis` and the dashboard's Approve button.

## Atlassian: Jira + Forge (Track 1)

- The orchestrator calls Jira REST v3 directly (`services/jira.ts`): it creates issues (`needs-repro`), comments with repro, culprit and candidate results, adds labels (`repro-confirmed`, `agent-fixable`), and transitions to In Progress / Done.
- `packages/forge-app`: a **Jira issue panel** (UI Kit) shows stage, repro race, culprit, candidate scores, the winning diff and the agent trace. A **trigger** on `avi:jira:updated:issue` reads the issue's labels and, when `agent-fixable` is present, calls the orchestrator webhook, which starts the Droid tournament. Forge only forwards; all long work runs in the orchestrator.
- Setup: `npm i -g @forge/cli`, `forge login`, `forge register` (puts the app id in `manifest.yml`), `forge variables set ORCH_URL https://<tunnel>`, `forge variables set --encrypt PATCHLINE_SECRET <FORGE_WEBHOOK_SECRET>`, optional `forge variables set DASHBOARD_URL ...`, then update the `external.fetch.backend` host, `npm install`, `forge deploy`, `forge install`. Expose the orchestrator with `cloudflared tunnel --url http://localhost:8787`.

## SpacetimeDB

`packages/spacetime/src/index.ts` defines every table in the data model (report, cluster, pipeline, agent_run, repro_attempt, fix_candidate, breaker_test, audit_event, quarantine) as public tables. Writes go through upsert reducers, which only the orchestrator identity may call (`claimOwner`). The orchestrator's `SpacetimeMirror` store forwards every row change to those reducers. The dashboard subscribes to SpacetimeDB directly through generated bindings (`packages/dashboard/src/module_bindings`), so the board, agent lanes and audit log are live SpacetimeDB subscriptions; it falls back to the orchestrator's SSE stream only in mock mode. The header badge shows which source is live.

Local setup:
1. Install the CLI (Windows: `iwr https://windows.spacetimedb.com -useb | iex`), then `spacetime start`.
2. `spacetime publish --server local -p packages/spacetime patchline`
3. Leave `MOCK_SPACETIME` empty in `.env` and start the orchestrator. On first boot it claims ownership and saves its token to `.data/spacetime-token`. Keep that file: only the owning identity can write. To start over, republish with `--delete-data=always` and delete the token file.
4. After a schema change, regenerate the bindings: `spacetime generate --lang typescript -p packages/spacetime -o packages/dashboard/src/module_bindings`.

## Apify

- Showcase: public Steam reviews and Reddit posts of a popular indie game. `pnpm showcase:fetch` runs the actors once and saves to `fixtures/showcase/`; the dashboard's **Steam/Reddit showcase** button clusters them with batched intake. There is no repro, since we don't have that game's repo. Usernames are masked in the UI.
- Stretch (Best Actor): a custom `game-feedback-collector` actor that emits the `Report` shape. Not built yet.

## Dashboard, bug write-ups, phone app

- **Dashboard** (`/`): one page with live stats, the bug list (progress and next action per bug), agent activity, and collapsible security (quarantine, policy) and showcase panels. Clicking a bug opens its drawer: write-up (with "Copy as Markdown" for changelogs), reports, repro race, fix candidates and audit trail.
- **Phone**: the same dashboard is responsive and installable (Add to Home Screen on iOS or Android). Each bug shows its progress and one action: **Run fix** (start the Droid tournament), **Approve & ship**, or **Revert**. Every action opens a confirmation sheet first.
- **Revert**: available on any merged fix (dashboard drawer, phone, `POST /clusters/:id/revert`). It adds a `git revert` commit on main (history is kept, nothing is force-pushed), pushes if `GAME_REPO_PUSH=1`, re-runs the full suite on the reverted main, and moves the Jira issue back to In Progress. The bug moves to "Needs a human", and the fix tournament can run again.

### Deploying the dashboard on Vercel

`vercel.json` at the repo root builds `packages/dashboard` as a static site (pnpm workspace install, SPA rewrite to the single page). A hosted page is served over HTTPS, so everything it talks to must be HTTPS/WSS:

1. **Orchestrator**: expose it with a tunnel (`cloudflared tunnel --url http://localhost:8787`) and set `VITE_API_URL=https://<tunnel>` in the Vercel project's environment variables.
2. **SpacetimeDB**: publish the module to Maincloud (`spacetime login`, then `spacetime publish --server maincloud -p packages/spacetime <db-name>`), point the orchestrator at it (`SPACETIME_URI=wss://maincloud.spacetimedb.com`, `SPACETIME_DB=<db-name>`), and set the same values as `VITE_SPACETIME_URI` / `VITE_SPACETIME_DB` in Vercel. The board then stays live straight from SpacetimeDB even when the orchestrator is offline; only actions need the orchestrator.
3. Import the repo in Vercel (root directory = repo root) and deploy. `VITE_*` variables are read at build time, so redeploy after changing them.

## Known limitations

- The engine needs a deterministic sim, or a replay, to prove bugs. Text-only reports go through the repro race, and vague reports can end as `not_reproducible`: the tunneling and frame-drop clusters in the demo do, and Patchline asks reporters a follow-up question. Unity/Godot support is future work.
- The quarantine regex can false-positive on innocent phrases (e.g. "push ... to the main menu"). Cut text is visible in the Quarantine tab.
- In the injection demo, the baseline agent uses a scripted naive planner (labelled as such) so the demo is repeatable.
- Real vs simulated: the game, replays, bisect, worktrees, verify and merge are real. The Discord community in the demo is simulated (`/discord/simulate`), unless a bot token is set.

## Verification status

Verified live (Oct 24):
- SpacetimeDB 2.13 local: identity, `claim_owner`, upsert reducers (snake_case canonical names), SATS option encoding, and the dashboard's subscription through the generated bindings.
- Factory Droid SDK 0.10 with a live `droid` CLI (`pnpm droid:smoke`): Droid fixed the score-reset bug inside the allowlist; scope check, repro and full suite all passed.
- Jira Cloud REST: create Bug, comment, label, transition In Progress → Done.
- Cartesia `/tts/bytes`: returns MP3 audio (`Cartesia-Version: 2026-08-14`).
- Claude: the full e2e pipeline (intake, repro race, breaker) with real model calls. The docs agent has so far only run against the mock.

Not verified yet:
- Forge manifest and UI Kit components: run `forge lint`, then `forge deploy`.
- SpacetimeDB Maincloud and the hosted Vercel build (the local versions are verified).
