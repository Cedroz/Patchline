// Deterministic replay: same seed/start state + same inputs => same final state.
import { assertInvariants, cloneState, createState, InvariantError, step, type State } from './sim';

export interface Replay {
  seed: number;
  startState?: State;
  inputs: number[]; // one bitmask per frame
}

export interface ReplayResult {
  finalState: State;
  frames: number;
  error?: { name: string; code: string; frame: number; message: string };
}

export function runReplay({ seed, startState, inputs }: Replay): ReplayResult {
  let s = startState ? cloneState(startState) : createState(seed);
  for (let i = 0; i < inputs.length; i++) {
    const next = step(s, inputs[i] ?? 0);
    try {
      assertInvariants(next, s);
    } catch (e) {
      if (e instanceof InvariantError) {
        return { finalState: next, frames: i + 1, error: { name: e.name, code: e.code, frame: e.frame, message: e.message } };
      }
      throw e;
    }
    s = next;
  }
  return { finalState: s, frames: inputs.length };
}

/** Run-length encode inputs: [value, count, value, count, ...]. */
export function encodeInputs(inputs: number[]): number[] {
  const out: number[] = [];
  for (const v of inputs) {
    if (out.length && out[out.length - 2] === v) out[out.length - 1]++;
    else out.push(v, 1);
  }
  return out;
}

export function decodeInputs(rle: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < rle.length; i += 2) for (let n = 0; n < rle[i + 1]; n++) out.push(rle[i]);
  return out;
}
