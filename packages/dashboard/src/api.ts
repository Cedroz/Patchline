// Orchestrator client. Defaults to the same host on :8787 so a phone on the LAN can use /voice.
export const API: string = import.meta.env.VITE_API_URL ?? `${location.protocol}//${location.hostname}:8787`;

export async function post<T = unknown>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { reason?: string; error?: string }).reason ?? (data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export async function get<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Meta {
  services: Record<string, string>;
  policy: { grants: Record<string, string[]>; readsUntrustedText: string[]; quarantineRules: string[] };
  game: { repo: string; liveUrl: string; push: boolean; head: string | null };
  publicUrl: string;
  jiraBrowse: string | null;
}

export const maskName = (name: string) => (name ? `${name.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, name.length - 1)))}` : 'anon');
export const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};
