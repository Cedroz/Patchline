// Browser entry: fixed-timestep loop, keyboard/touch input, recorder, replay viewer.
import { InputRecorder } from './recorder';
import { decodeInputs, type Replay } from './replay';
import { render } from './render';
import { PATCHLINE_URL, setupReportButton } from './report';
import { assertInvariants, cloneState, createState, DT, INPUT, InvariantError, step, type State } from './sim';
import './style.css';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

type Key = 'jump' | 'duck' | 'pause';
const held: Record<Key, boolean> = { jump: false, duck: false, pause: false };
const keyMap: Record<string, Key> = {
  Space: 'jump',
  ArrowUp: 'jump',
  KeyW: 'jump',
  ArrowDown: 'duck',
  KeyS: 'duck',
  KeyP: 'pause',
  Escape: 'pause',
};
let modalOpen = false;

window.addEventListener('keydown', (e) => {
  if (modalOpen) return;
  const k = keyMap[e.code];
  if (k) {
    held[k] = true;
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  const k = keyMap[e.code];
  if (k) held[k] = false;
});

const buttons: Array<[string, Key]> = [
  ['btn-jump', 'jump'],
  ['btn-duck', 'duck'],
  ['btn-pause', 'pause'],
];
for (const [id, k] of buttons) {
  const el = document.getElementById(id)!;
  el.addEventListener('pointerdown', (e) => {
    held[k] = true;
    e.preventDefault();
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => (held[k] = false));
}
canvas.addEventListener('pointerdown', () => (held.jump = true));
canvas.addEventListener('pointerup', () => (held.jump = false));

function currentInput(): number {
  return (held.jump ? INPUT.JUMP : 0) | (held.duck ? INPUT.DUCK : 0) | (held.pause ? INPUT.PAUSE : 0);
}

function startLive(): void {
  const seed = (Math.random() * 2 ** 32) >>> 0; // seed choice is outside the sim, so this is fine
  let state: State = createState(seed);
  const recorder = new InputRecorder(state);

  setupReportButton(
    () => ({ seed, ...recorder.export() }),
    (open) => {
      modalOpen = open;
      if (open) held.jump = held.duck = held.pause = false;
    },
  );

  let acc = 0;
  let last = performance.now();
  const frame = (now: number) => {
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= DT) {
      const input = modalOpen ? 0 : currentInput();
      recorder.record(input);
      state = step(state, input);
      acc -= DT;
    }
    render(ctx, state);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function startReplay(id: string): Promise<void> {
  document.body.classList.add('replay-mode');
  const res = await fetch(`${PATCHLINE_URL}/replays/${encodeURIComponent(id)}`);
  if (!res.ok) {
    ctx.fillStyle = '#fff';
    ctx.fillText(`Replay ${id} not found`, 20, 40);
    return;
  }
  const data = (await res.json()) as Replay & { inputsRle?: number[] };
  const inputs = data.inputsRle ? decodeInputs(data.inputsRle) : data.inputs;
  let state = data.startState ? cloneState(data.startState) : createState(data.seed);
  let i = 0;
  let banner = `replay ${id}`;
  const tick = () => {
    if (i < inputs.length) {
      const next = step(state, inputs[i]);
      try {
        assertInvariants(next, state);
      } catch (e) {
        if (e instanceof InvariantError) {
          banner = e.message;
          i = inputs.length;
        }
      }
      state = next;
      i++;
    }
    render(ctx, state, banner);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const replayId = new URLSearchParams(location.search).get('replay');
if (replayId) startReplay(replayId);
else startLive();
