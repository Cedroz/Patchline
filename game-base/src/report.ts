// "Report bug" modal: sends the player's text plus the recorded replay to Patchline.
import type { State } from './sim';

declare const __COMMIT_SHA__: string;
export const PATCHLINE_URL: string = import.meta.env.VITE_PATCHLINE_URL ?? 'http://localhost:8787';

export interface ReportPayload {
  text: string;
  seed: number;
  snapshot: State;
  inputs: number[];
  commit: string;
}

type Capture = { seed: number; snapshot: State; inputs: number[] };

export function setupReportButton(capture: () => Capture, onOpenChange: (open: boolean) => void): void {
  const button = document.getElementById('report-btn') as HTMLButtonElement;
  const modal = document.getElementById('report-modal') as HTMLDivElement;
  const text = document.getElementById('report-text') as HTMLTextAreaElement;
  const send = document.getElementById('report-send') as HTMLButtonElement;
  const cancel = document.getElementById('report-cancel') as HTMLButtonElement;
  const status = document.getElementById('report-status') as HTMLParagraphElement;
  let captured: Capture | null = null;

  const close = () => {
    modal.hidden = true;
    onOpenChange(false);
  };

  button.addEventListener('click', () => {
    captured = capture(); // freeze the replay at the moment the player hit the button
    text.value = '';
    status.textContent = '';
    modal.hidden = false;
    onOpenChange(true);
    text.focus();
  });
  cancel.addEventListener('click', close);

  send.addEventListener('click', async () => {
    if (!captured) return;
    const payload: ReportPayload = { text: text.value.trim() || '(no description)', ...captured, commit: __COMMIT_SHA__ };
    send.disabled = true;
    status.textContent = 'Sending...';
    try {
      const res = await fetch(`${PATCHLINE_URL}/reports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      status.textContent = res.ok ? `Thanks! Tracking as report ${body.id}.` : `Failed: ${body.error ?? res.status}`;
      if (res.ok) setTimeout(close, 1500);
    } catch {
      status.textContent = 'Could not reach the bug tracker.';
    } finally {
      send.disabled = false;
    }
  });
}
