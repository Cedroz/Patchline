// Code templates for generated tests. Repro tests run untracked from __repro__/ inside a worktree.

export const REPRO_DIR = '__repro__';

/** Replay path: no LLM. The test fails with the invariant's message if the replay breaks an invariant. */
export function replayTest(replayId: string, replay: { seed: number; startState?: unknown; inputsRle: number[] }): string {
  return `// Patchline repro, generated from replay ${replayId} (deterministic, no LLM).
import { it } from 'vitest';
import { decodeInputs, runReplay } from '../src/replay';

const replay = ${JSON.stringify(replay)};

it('replay ${replayId} runs without invariant violations', () => {
  const r = runReplay({ seed: replay.seed, startState: replay.startState as never, inputs: decodeInputs(replay.inputsRle) });
  if (r.error) throw new Error(r.error.message);
});
`;
}

/** The API surface LLM-drafted tests may use. Sent to Claude as "sim API docs". */
export const SIM_API_DOC = `Test files live in __repro__/ and import from '../src/sim' and '../src/replay'. Use vitest (import { it, expect } from 'vitest').
src/sim.ts exports:
  INPUT = { JUMP: 1, DUCK: 2, PAUSE: 4 }   // one bitmask per frame; PAUSE toggles on the frame it is first pressed
  createState(seed: number): State
  step(state: State, input: number): State // pure, 60 Hz
  assertInvariants(next: State, prev?: State): void // throws InvariantError(code) for impossible states
  WORLD = { width: 800, height: 300, groundY: 250 }, PLAYER = { x: 80, w: 30, h: 40, duckH: 22 }
  State fields: frame, runId, player { y, vy, onGround, ducking }, speed, distance, score, coins, obstacles[], coinList[], paused, gameOver
  InvariantError codes: 'non_finite_position', 'player_out_of_bounds', 'score_decreased'
src/replay.ts exports:
  runReplay({ seed, startState?, inputs: number[] }): { finalState, frames, error?: { code, frame, message } }
A repro test must script inputs, call runReplay (which checks invariants every frame), and end with:
  if (r.error) throw new Error(r.error.message);
so it fails on the buggy build with the invariant's message and passes on a correct build.`;

/** Wrap a breaker test body list into one file so each is its own vitest case. */
export function breakerFile(tests: { name: string; code: string }[]): string {
  return tests.map((t) => t.code.trim()).join('\n\n') + '\n';
}
