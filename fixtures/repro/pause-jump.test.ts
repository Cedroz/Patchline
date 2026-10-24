// Hand-written repro for the planted pause-jump freeze: pressing jump while paused.
import { it } from 'vitest';
import { runReplay } from '../src/replay';
import { INPUT } from '../src/sim';

it('jumping while paused does not freeze the player', () => {
  const inputs = [...new Array(30).fill(0), INPUT.PAUSE, 0, INPUT.JUMP, INPUT.JUMP, 0, INPUT.PAUSE, ...new Array(30).fill(0)];
  const r = runReplay({ seed: 2, inputs });
  if (r.error) throw new Error(r.error.message);
});
