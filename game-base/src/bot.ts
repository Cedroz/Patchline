// Simple autopilot used by tests and demo fixtures: jumps when an obstacle is close.
import { INPUT, PLAYER, type State } from './sim';

export function botInput(s: State): number {
  if (s.gameOver) return 0;
  const lead = 30 + s.speed * 0.12;
  const near = s.obstacles.some((o) => o.x > PLAYER.x - 5 && o.x - (PLAYER.x + PLAYER.w) < lead);
  return near ? INPUT.JUMP : 0;
}
