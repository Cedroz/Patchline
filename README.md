# Patchline

**An AI QA team for indie game studios.** Patchline turns player complaints into a reproduced bug, the exact commit that caused it, and a verified fix that a human approves.

> Every AI debugger guesses. Ours proves it: reproduce the bug from a player's complaint, find the commit that broke it, and only show you fixes that pass.

Built at Cal Hacks 13.0 for indie teams of 1 to 5 people with no QA staff, whose bug reports are scattered across in-game reports, Discord, Steam and Reddit.

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
  packages/dashboard/     React board, agent lanes, issue drawer, audit log, /voice phone view
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
| merger | `repo_merge`, `repo_push`, Jira comment/transition, chat reply. Runs **only** after human approval |
| baseline (demo) | everything, but only against a throwaway clone with its remote removed and a fake `.env` |

## Factory Droid: where and how Droid runs

- **Trigger:** a cluster reaches `culprit_found` and its Jira issue has the `agent-fixable` label. A human adds it (the Forge trigger forwards it), or the demo adds it automatically (`AUTO_AGENT_FIXABLE=1`). The dashboard's "Start Droid fix tournament" button does the same thing.
- **What runs:** `packages/orchestrator/src/services/fix-agents.ts` → `DroidFixAgent`. It uses `createSession` from `@factory/droid-sdk/node`, with `cwd` set to a dedicated git worktree on branch `fix/<cluster>/<n>`. Two sessions run in parallel with different instructions: "smallest change" and "root cause in the culprit change".
- **Limits on what it can touch:** `autonomyLevel: Off` routes every tool use through our `permissionHandler`. It allows edits and creates **only** to files touched by the culprit commit (the bisect result), and commands **only** to run vitest. Everything else is cancelled and logged as `[permission] DENY`. After the run, `scopeCheck` checks the git diff again: any file outside the allowlist or any test file rejects the candidate.
- **Visible:** each candidate's plan, streamed steps (assistant text, tool calls, permission decisions), diff, gate results and score appear live on the dashboard. The Forge panel shows the same.
- `ClaudeFixAgent` (Anthropic API, writes whole files within the allowlist) and `MockFixAgent` sit behind the same `FixAgent` interface (`FIX_AGENT=droid|claude|mock`).
- Needs the `droid` CLI on PATH plus `FACTORY_API_KEY`.

## Anthropic: how Claude is used, and where it can go wrong

Claude reads messy text and drafts code. It never decides truth.

- **Intake** (`agents/intake.ts`): clusters reports and extracts repro steps as zod-validated JSON (structured outputs via `client.beta.messages.parse`, model from `ANTHROPIC_MODEL`, server-side refusal fallback enabled).
- **Repro race** (`agents/repro.ts`): three interpretations of a text-only report, each written as a Vitest test.
- **Breaker** (`agents/breaker.ts`), **quarantine classifier**, **voice brief and intents**.

Where it can go wrong for users:

1. **It can merge two different bugs into one cluster, or split one bug in two.** Clusters are visible and editable in Jira; the repro and bisect run per cluster, so a wrong cluster shows up as a failed repro or a strange culprit.
2. **It can write repro tests that fail for the wrong reason** (syntax errors, a nonexistent API). These are blocked by the validity rule: a test must fail on `main` with the *expected* `InvariantError` and pass on the good commit. The demo race shows one draft rejected exactly this way.
3. **It can trust player text too much.** Quarantine cuts instruction-like spans before any LLM sees them, and no agent that reads player text holds code tools.
4. **It can write a fix that hides the symptom.** The breaker tests and the verify gate catch it. In the demo, the "clamp at 255" fix passes the repro but fails all 3 breakers and loses.

## Cartesia: voice

- `/voice` on a phone. **"What's new?"** gives a ~20-second brief, built by Claude from live state and spoken with **Cartesia TTS** (`POST /tts/bytes`, `sonic-3.6`, mp3). Commands are parsed by Claude into intents: `approve`, `details`, `repeat`, `brief`, `cancel`.
- **Approve always needs confirmation:** "Approving the fix for X. Say yes to confirm." Only a spoken or tapped "yes" merges.
- **Responsible use:** player names, handles and emails are scrubbed before text reaches TTS (`scrubNames`). Only bug titles and stages are spoken.
- **Limits:** speech input uses the browser Web Speech API, which needs HTTPS (use the tunnel URL) and is unsupported in some browsers; the page falls back to typed input. If Cartesia fails, the page falls back to `speechSynthesis` and the dashboard's Approve button.

## Atlassian: Jira + Forge (Track 1)

- The orchestrator calls Jira REST v3 directly (`services/jira.ts`): it creates issues (`needs-repro`), comments with repro, culprit and candidate results, adds labels (`repro-confirmed`, `agent-fixable`), and transitions to In Progress / Done.
- `packages/forge-app`: a **Jira issue panel** (UI Kit) shows stage, repro race, culprit, candidate scores, the winning diff and the agent trace. A **trigger** on `avi:jira:updated:issue` reads the issue's labels and, when `agent-fixable` is present, calls the orchestrator webhook, which starts the Droid tournament. Forge only forwards; all long work runs in the orchestrator.
- Setup: `npm i -g @forge/cli`, `forge login`, `forge register` (puts the app id in `manifest.yml`), `forge variables set ORCH_URL https://<tunnel>`, `forge variables set --encrypt PATCHLINE_SECRET <FORGE_WEBHOOK_SECRET>`, optional `forge variables set DASHBOARD_URL ...`, then update the `external.fetch.backend` host, `npm install`, `forge deploy`, `forge install`. Expose the orchestrator with `cloudflared tunnel --url http://localhost:8787`.

## SpacetimeDB

`packages/spacetime/src/index.ts` defines every table in the data model (report, cluster, pipeline, agent_run, repro_attempt, fix_candidate, breaker_test, audit_event, quarantine) as public tables. Writes go through upsert reducers, which only the orchestrator identity may call (`claimOwner`). The orchestrator's `SpacetimeMirror` store forwards every row change to those reducers. Publish with the SpacetimeDB CLI, then set `SPACETIME_URI` / `SPACETIME_DB`.

## Apify

- Showcase: public Steam reviews and Reddit posts of a popular indie game. `pnpm showcase:fetch` runs the actors once and saves to `fixtures/showcase/`; the dashboard's **Steam/Reddit showcase** button clusters them with batched intake. There is no repro, since we don't have that game's repo. Usernames are masked in the UI.
- Stretch (Best Actor): a custom `game-feedback-collector` actor that emits the `Report` shape. Not built yet.

## Known limitations

- The engine needs a deterministic sim, or a replay, to prove bugs. Text-only reports go through the repro race, and vague reports can end as `not_reproducible`: the tunneling and frame-drop clusters in the demo do, and Patchline asks reporters a follow-up question. Unity/Godot support is future work.
- The quarantine regex can false-positive on innocent phrases (e.g. "push ... to the main menu"). Cut text is visible in the Quarantine tab.
- In the injection demo, the baseline agent uses a scripted naive planner (labelled as such) so the demo is repeatable.
- Real vs simulated: the game, replays, bisect, worktrees, verify and merge are real. The Discord community in the demo is simulated (`/discord/simulate`), unless a bot token is set.

## Not verified yet (check at the workshops before relying on it)

- SpacetimeDB HTTP reducer-call route and option encoding in `store/spacetime.ts`. The module itself typechecks against `spacetimedb@2.13`.
- The Droid SDK run against a live `droid` CLI. Code follows the SDK's own permission-handler and stream examples (v0.10).
- Forge manifest and UI Kit components: run `forge lint`.
- Cartesia request body: it follows the `/tts/bytes` API reference, `Cartesia-Version: 2026-08-14`.
