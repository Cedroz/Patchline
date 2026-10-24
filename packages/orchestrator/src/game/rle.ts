// Run-length encoding for per-frame input logs (same format as the game's replay.ts).

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
