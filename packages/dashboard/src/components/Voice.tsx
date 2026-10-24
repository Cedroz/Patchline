// /voice: hands-free phone view. "What's new?" brief, spoken commands, confirmed approve.
// Speech in: browser Web Speech API (needs HTTPS or localhost). Speech out: Cartesia via the orchestrator,
// falling back to the browser's speechSynthesis. Typed input always works as a fallback.
import { useRef, useState } from 'react';
import { API, get, post } from '../api';

interface Pending {
  action: 'approve';
  cluster_id: string;
}

type SpeechRec = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; onerror: () => void; start: () => void };

export function VoicePage() {
  const [log, setLog] = useState<{ who: 'you' | 'patchline'; text: string }[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [typed, setTyped] = useState('');
  const last = useRef('');

  const speak = async (text: string) => {
    last.current = text;
    setLog((l) => [...l, { who: 'patchline', text }]);
    setSpeaking(true);
    try {
      const res = await fetch(`${API}/voice/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      if (res.status === 200) {
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          void audio.play().catch(() => resolve());
        });
        return;
      }
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        u.onend = () => resolve();
        u.onerror = () => resolve();
        speechSynthesis.speak(u);
      });
    } finally {
      setSpeaking(false);
    }
  };

  const brief = async () => {
    const { text } = await get<{ text: string }>('/voice/brief');
    await speak(text);
  };

  const command = async (utterance: string) => {
    if (!utterance.trim()) return;
    setLog((l) => [...l, { who: 'you', text: utterance }]);
    const res = await post<{ say: string; pending: Pending | null }>('/voice/command', { utterance, pending });
    setPending(res.pending);
    await speak(res.say === '__repeat__' ? last.current || 'Nothing to repeat yet.' : res.say);
  };

  const listen = () => {
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) {
      setLog((l) => [...l, { who: 'patchline', text: 'Speech input is not available in this browser. Type below instead.' }]);
      return;
    }
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.onresult = (e) => void command(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  };

  return (
    <div className="voice">
      <h1>Patchline</h1>
      <button className="big" disabled={speaking} onClick={() => void brief()}>
        What's new?
      </button>
      <button className={`big mic ${listening ? 'on' : ''}`} disabled={speaking} onClick={listen}>
        {listening ? 'Listening…' : '🎙 Hold to talk (tap)'}
      </button>
      {pending && (
        <div className="confirm">
          Waiting for confirmation to approve.
          <div className="row">
            <button className="approve" onClick={() => void command('yes')}>
              Yes, approve
            </button>
            <button onClick={() => void command('cancel')}>Cancel</button>
          </div>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void command(typed);
          setTyped('');
        }}
      >
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder='Try "approve the score fix" or "details"' />
      </form>
      <div className="voice-log">
        {[...log].reverse().map((m, i) => (
          <p key={i} className={m.who}>
            <strong>{m.who}:</strong> {m.text}
          </p>
        ))}
      </div>
      <p className="muted small">Player names are never read aloud. Approving always needs a spoken or tapped “yes”.</p>
    </div>
  );
}
