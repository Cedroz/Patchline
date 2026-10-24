// pnpm seed:demo -> asks the running orchestrator to replay the 30 fixture reports onto the board.
import { config } from '../config';

const base = `http://localhost:${config.port}`;
const reset = process.argv.includes('--reset');
if (reset) await fetch(`${base}/demo/reset`, { method: 'POST' });
const res = await fetch(`${base}/demo/seed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null);
if (!res?.ok) {
  console.error(`Could not reach the orchestrator at ${base}. Start it with pnpm dev first.`);
  process.exit(1);
}
console.log('Seeding 30 demo reports. Watch the board.');
