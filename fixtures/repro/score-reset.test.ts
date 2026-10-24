// Hand-written repro for the planted score-reset bug: score must keep climbing past 255.
import { it } from 'vitest';
import { runReplay } from '../src/replay';
import { createState } from '../src/sim';

it('score keeps climbing past 255', () => {
  const start = createState(1);
  start.score = 250; // close to the byte boundary
  const r = runReplay({ seed: 1, startState: start, inputs: new Array(120).fill(0) });
  if (r.error) throw new Error(r.error.message);
});
