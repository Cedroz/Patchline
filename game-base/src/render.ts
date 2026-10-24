// Canvas renderer. Reads State, never mutates it.
import { formatScore } from './scoring';
import { PLAYER, WORLD, type State } from './sim';

const COLORS = {
  sky: '#0f172a',
  ground: '#334155',
  player: '#38bdf8',
  obstacle: '#f97316',
  coin: '#facc15',
  text: '#e2e8f0',
};

export function render(ctx: CanvasRenderingContext2D, s: State, banner?: string): void {
  const { width, height, groundY } = WORLD;
  ctx.fillStyle = COLORS.sky;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(0, groundY, width, height - groundY);

  for (const o of s.obstacles) {
    ctx.fillStyle = COLORS.obstacle;
    ctx.fillRect(o.x, groundY - o.h, o.w, o.h);
  }
  for (const c of s.coinList) {
    if (c.taken) continue;
    ctx.fillStyle = COLORS.coin;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  const p = s.player;
  if (Number.isFinite(p.y)) {
    const h = p.ducking && p.onGround ? PLAYER.duckH : PLAYER.h;
    ctx.fillStyle = COLORS.player;
    ctx.fillRect(PLAYER.x, p.y - h, PLAYER.w, h);
  }

  ctx.fillStyle = COLORS.text;
  ctx.font = '16px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`SCORE ${formatScore(s.score)}`, width - 16, 28);
  ctx.textAlign = 'left';
  ctx.fillText(`COINS ${s.coins}`, 16, 28);

  ctx.textAlign = 'center';
  if (s.gameOver) {
    ctx.font = '28px monospace';
    ctx.fillText('GAME OVER', width / 2, 120);
    ctx.font = '14px monospace';
    ctx.fillText('press jump to restart', width / 2, 150);
  } else if (s.paused) {
    ctx.font = '28px monospace';
    ctx.fillText('PAUSED', width / 2, 130);
  }
  if (banner) {
    ctx.font = '14px monospace';
    ctx.fillStyle = '#fca5a5';
    ctx.fillText(banner, width / 2, height - 12);
  }
}
