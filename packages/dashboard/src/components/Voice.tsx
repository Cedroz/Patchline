// Voice panel on the dashboard: "What's new?" brief, spoken commands, confirmed approve.
// Speech in: browser Web Speech API (needs HTTPS or localhost). Speech out: Cartesia via the orchestrator,
// falling back to the browser's speechSynthesis. Typed input always works as a fallback.
import { useRef, useState } from 'react';
import { API, get, post, type Meta } from '../api';

interface Pending {
  action: 'approve';
  cluster_id: string;
}

type SpeechRec = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; onerror: () => void; start: () => void };

export function VoicePanel({ meta }: { meta: Meta | null }) {
  const [log, setLog] = useState<{ who: 'you' | 'patchline'; text: string }[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [typed, setTyped] = useState('');
  const last = useRef('');
  const engine = meta?.services.voice;

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
        setTimeout(resolve, 2000 + text.length * 90); // some browsers never fire onend
      });
    } finally {
      setSpeaking(false);
    }
  };

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      setLog((l) => [...l, { who: 'patchline', text: `Could not reach the orchestrator (${(e as Error).message}).` }]);
      setSpeaking(false);
    }
  };

  const brief = () =>
    run(async () => {
      const { text } = await get<{ text: string }>('/voice/brief');
      await speak(text);
    });

  const command = (utterance: string) =>
    run(async () => {
      if (!utterance.trim()) return;
      setLog((l) => [...l, { who: 'you', text: utterance }]);
      const res = await post<{ say: string; pending: Pending | null }>('/voice/command', { utterance, pending });
      setPending(res.pending);
      await speak(res.say === '__repeat__' ? last.current || 'Nothing to repeat yet.' : res.say);
    });

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
    <section className="voice-panel">
      <div className="voice-head">
        <h3>Voice</h3>
        {engine && (
          <span className={`badge ${engine.startsWith('mock') ? 'mock' : 'real'}`} title="text-to-speech engine">
            {engine.startsWith('mock') ? 'browser voice' : engine}
          </span>
        )}
      </div>
      <div className="voice-buttons">
        <button className="primary" disabled={speaking} onClick={() => void brief()}>
          {speaking ? 'Speaking…' : "What's new?"}
        </button>
        <button className={`mic ${listening ? 'on' : ''}`} disabled={speaking} onClick={listen}>
          {listening ? 'Listening…' : 'Talk'}
        </button>
      </div>
      {pending && (
        <div className="confirm">
          Approve this fix?
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
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder='Or type: "details", "approve the fix"' />
      </form>
      {log.length > 0 && (
        <div className="voice-log">
          {[...log]
            .reverse()
            .slice(0, 4)
            .map((m, i) => (
              <p key={i} className={m.who}>
                <strong>{m.who === 'you' ? 'You' : 'Patchline'}:</strong> {m.text}
              </p>
            ))}
        </div>
      )}
    </section>
  );
}
