// Score arithmetic and formatting, shared by the sim and the HUD.

export function addScore(score: number, points: number): number {
  return score + points;
}

export function formatScore(score: number): string {
  return String(Math.floor(score)).padStart(5, '0');
}
