// Entry: /voice (or #voice) is the phone view; everything else is the board.
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { VoicePage } from './components/Voice';
import './styles.css';

const isVoice = location.pathname.startsWith('/voice') || location.hash === '#voice';
createRoot(document.getElementById('root')!).render(isVoice ? <VoicePage /> : <App />);
