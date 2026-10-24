// Short sortable ids: <prefix>_<time36><rand>.
import { randomBytes } from 'node:crypto';

export function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}
