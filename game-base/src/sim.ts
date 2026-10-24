// Pure, deterministic game simulation. No DOM, no Date.now(), no Math.random().
// step(state, input) -> new state at a fixed 60 Hz. Everything else (rendering,
// input capture, replays) is built on top of this.
import { addScore } from './scoring';

export const FPS = 60;
export const DT = 1 / FPS;

export const WORLD = { width: 800, height: 300, groundY: 250 } as const;
export const PLAYER = { x: 80, w: 30, h: 40, duckH: 22 } as const;

export const GRAVITY = 2400; // px/s^2
export const JUMP_VELOCITY = 820; // px/s
export const BASE_SPEED = 260; // px/s
export const SPEED_RAMP = 4; // px/s gained per second of play
export const MAX_SPEED = 520;
export const MIN_GAP = 380;
export const MAX_GAP = 700;
export const COIN_POINTS = 5;
export const TICK_FRAMES = 6; // +1 score every 6 frames of play

/** One bitmask per frame. */
export const INPUT = { JUMP: 1, DUCK: 2, PAUSE: 4 } as const;

export interface Obstacle {
  x: number;
  w: number;
  h: number;
}

export interface Coin {
  x: number;
  y: number;
  taken: boolean;
}

export interface Player {
  y: number; // feet position
  vy: number;
  onGround: boolean;
  ducking: boolean;
}

export interface State {
  seed: number;
  rngState: number;
  frame: number; // total frames stepped, including paused ones
  runId: number; // increments on every restart
  runFrames: number; // frames of actual play in this run
  player: Player;
  speed: number;
  distance: number;
  nextSpawnAt: number; // distance at which the next obstacle spawns
  score: number;
  best: number;
  coins: number;
  obstacles: Obstacle[];
  coinList: Coin[];
  paused: boolean;
  gameOver: boolean;
  prevInput: number;
}

// mulberry32, with its state carried inside State so step() stays pure.
function nextRandom(s: State): number {
  let t = (s.rngState = (s.rngState + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randRange(s: State, min: number, max: number): number {
  return min + (max - min) * nextRandom(s);
}

export function createState(seed: number): State {
  return {
    seed: seed >>> 0,
    rngState: seed >>> 0,
    frame: 0,
    runId: 0,
    runFrames: 0,
    player: { y: WORLD.groundY, vy: 0, onGround: true, ducking: false },
    speed: BASE_SPEED,
    distance: 0,
    nextSpawnAt: 500,
    score: 0,
    best: 0,
    coins: 0,
    obstacles: [],
    coinList: [],
    paused: false,
    gameOver: false,
    prevInput: 0,
  };
}

export function cloneState(s: State): State {
  return {
    ...s,
    player: { ...s.player },
    obstacles: s.obstacles.map((o) => ({ ...o })),
    coinList: s.coinList.map((c) => ({ ...c })),
  };
}

function resetRun(s: State): void {
  s.runId += 1;
  s.runFrames = 0;
  s.player = { y: WORLD.groundY, vy: 0, onGround: true, ducking: false };
  s.speed = BASE_SPEED;
  s.distance = 0;
  s.nextSpawnAt = 500;
  s.score = 0;
  s.coins = 0;
  s.obstacles = [];
  s.coinList = [];
  s.gameOver = false;
  s.paused = false;
}

function spawn(s: State): void {
  const w = Math.floor(randRange(s, 20, 36));
  const h = Math.floor(randRange(s, 30, 55));
  s.obstacles.push({ x: WORLD.width + 20, w, h });
  // A coin floats somewhere between this obstacle and the next.
  const gap = randRange(s, MIN_GAP, MAX_GAP);
  if (nextRandom(s) < 0.7) {
    s.coinList.push({
      x: WORLD.width + 20 + gap * randRange(s, 0.35, 0.65),
      y: WORLD.groundY - randRange(s, 60, 130),
      taken: false,
    });
  }
  s.nextSpawnAt = s.distance + gap;
}

function playerHeight(p: Player): number {
  return p.ducking && p.onGround ? PLAYER.duckH : PLAYER.h;
}

function overlaps(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function step(prev: State, input: number): State {
  const s = cloneState(prev);
  const pressed = input & ~prev.prevInput;
  s.frame += 1;
  s.prevInput = input;

  if (s.gameOver) {
    if (pressed & INPUT.JUMP) resetRun(s);
    return s;
  }

  if (pressed & INPUT.PAUSE) s.paused = !s.paused;
  const dt = s.paused ? 0 : DT;
  const p = s.player;

  // Input
  p.ducking = (input & INPUT.DUCK) !== 0;
  if (input & INPUT.JUMP && p.onGround) {
    p.vy = -JUMP_VELOCITY;
    p.onGround = false;
  }

  // Physics
  p.vy += GRAVITY * dt;
  p.y += p.vy * dt;
  if (p.y >= WORLD.groundY) {
    p.y = WORLD.groundY;
    p.vy = 0;
    p.onGround = true;
  }

  if (s.paused) return s;

  // World scroll
  s.runFrames += 1;
  s.speed = Math.min(MAX_SPEED, BASE_SPEED + SPEED_RAMP * (s.runFrames / FPS));
  const dx = s.speed * dt;
  s.distance += dx;
  for (const o of s.obstacles) o.x -= dx;
  for (const c of s.coinList) c.x -= dx;
  s.obstacles = s.obstacles.filter((o) => o.x + o.w > -10);
  s.coinList = s.coinList.filter((c) => c.x > -10 && !c.taken);
  if (s.distance >= s.nextSpawnAt) spawn(s);

  // Scoring
  if (s.runFrames % TICK_FRAMES === 0) s.score = addScore(s.score, 1);

  const ph = playerHeight(p);
  const top = p.y - ph;
  for (const c of s.coinList) {
    if (!c.taken && overlaps(PLAYER.x, top, PLAYER.w, ph, c.x - 8, c.y - 8, 16, 16)) {
      c.taken = true;
      s.coins += 1;
      s.score = addScore(s.score, COIN_POINTS);
    }
  }
  s.best = Math.max(s.best, s.score);

  // Collisions
  for (const o of s.obstacles) {
    if (overlaps(PLAYER.x + 3, top + 3, PLAYER.w - 6, ph - 3, o.x, WORLD.groundY - o.h, o.w, o.h)) {
      s.gameOver = true;
      break;
    }
  }
  return s;
}

export class InvariantError extends Error {
  constructor(
    public code: string,
    public frame: number,
    detail = '',
  ) {
    super(`InvariantError(${code}) at frame ${frame}${detail ? `: ${detail}` : ''}`);
    this.name = 'InvariantError';
  }
}

/** Throws InvariantError if the state is impossible. Pass prev to check transitions. */
export function assertInvariants(s: State, prev?: State): void {
  const p = s.player;
  const numbers = [p.y, p.vy, s.distance, s.speed, ...s.obstacles.map((o) => o.x), ...s.coinList.map((c) => c.x)];
  if (!numbers.every(Number.isFinite)) {
    throw new InvariantError('non_finite_position', s.frame, `player.y=${p.y} player.vy=${p.vy}`);
  }
  if (p.y > WORLD.groundY + 0.001 || p.y < -1000) {
    throw new InvariantError('player_out_of_bounds', s.frame, `player.y=${p.y}`);
  }
  if (prev && prev.runId === s.runId && s.score < prev.score) {
    throw new InvariantError('score_decreased', s.frame, `${prev.score} -> ${s.score}`);
  }
}
