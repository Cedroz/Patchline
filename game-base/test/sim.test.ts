import { describe, expect, it } from 'vitest';
import { botInput } from '../src/bot';
import { InputRecorder } from '../src/recorder';
import { decodeInputs, encodeInputs, runReplay } from '../src/replay';
import { addScore, formatScore } from '../src/scoring';
import { assertInvariants, createState, INPUT, step, WORLD, type State } from '../src/sim';

function run(s: State, frames: number, input: number | ((s: State) => number) = 0): State {
  for (let i = 0; i < frames; i++) s = step(s, typeof input === 'function' ? input(s) : input);
  return s;
}

function botInputs(seed: number, frames: number): number[] {
  let s = createState(seed);
  const inputs: number[] = [];
  for (let i = 0; i < frames; i++) {
    const input = botInput(s);
    inputs.push(input);
    s = step(s, input);
  }
  return inputs;
}

describe('sim', () => {
  it('createState is deterministic for a seed', () => {
    expect(createState(42)).toEqual(createState(42));
  });

  it('step does not mutate its input', () => {
    const s = createState(1);
    const copy = JSON.parse(JSON.stringify(s));
    step(s, INPUT.JUMP);
    expect(s).toEqual(copy);
  });

  it('jump leaves the ground and gravity brings the player back', () => {
    let s = step(createState(1), INPUT.JUMP);
    s = run(s, 5);
    expect(s.player.y).toBeLessThan(WORLD.groundY);
    s = run(s, 60);
    expect(s.player.onGround).toBe(true);
    expect(s.player.y).toBe(WORLD.groundY);
  });

  it('pause stops the world from scrolling', () => {
    let s = run(createState(3), 30);
    s = step(s, INPUT.PAUSE);
    expect(s.paused).toBe(true);
    const d = s.distance;
    s = run(s, 60);
    expect(s.distance).toBe(d);
  });

  it('score increases over time', () => {
    const s = run(createState(5), 300, botInput);
    expect(s.score).toBeGreaterThan(30);
  });

  it('hitting an obstacle ends the run and jump restarts it', () => {
    let s = run(createState(7), 1200); // never jump
    expect(s.gameOver).toBe(true);
    s = step(s, INPUT.JUMP);
    expect(s.gameOver).toBe(false);
    expect(s.score).toBe(0);
    expect(s.runId).toBe(1);
  });

  it('invariants hold for 10 s of bot play', () => {
    let s = createState(11);
    for (let i = 0; i < 600; i++) {
      const next = step(s, botInput(s));
      assertInvariants(next, s);
      s = next;
    }
  });
});

describe('scoring', () => {
  it('adds points and formats with padding', () => {
    expect(addScore(10, 5)).toBe(15);
    expect(formatScore(42)).toBe('00042');
  });
});

describe('replay', () => {
  it('replays are deterministic', () => {
    const inputs = botInputs(99, 600);
    const a = runReplay({ seed: 99, inputs });
    const b = runReplay({ seed: 99, inputs });
    expect(a.error).toBeUndefined();
    expect(a.finalState).toEqual(b.finalState);
  });

  it('recorder snapshot + inputs replays to the live state', () => {
    let s = createState(123);
    const rec = new InputRecorder(s, 120);
    for (let i = 0; i < 400; i++) {
      const input = botInput(s);
      rec.record(input);
      s = step(s, input);
    }
    const { snapshot, inputs } = rec.export();
    expect(inputs).toHaveLength(120);
    expect(runReplay({ seed: 123, startState: snapshot, inputs }).finalState).toEqual(s);
  });

  it('run-length encoding round-trips', () => {
    const inputs = [0, 0, 1, 1, 1, 0, 4, 0];
    expect(decodeInputs(encodeInputs(inputs))).toEqual(inputs);
  });
});
