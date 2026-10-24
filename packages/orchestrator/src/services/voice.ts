// Cartesia TTS (POST /tts/bytes) and a mock that tells the browser to fall back to speechSynthesis.
import type { VoiceService } from '@patchline/core';

export class CartesiaVoice implements VoiceService {
  readonly name = 'cartesia';
  constructor(
    private apiKey: string,
    private voiceId: string,
    private model: string,
  ) {}

  async tts(text: string) {
    const res = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'cartesia-version': '2026-08-14',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model_id: this.model,
        transcript: text,
        voice: { id: this.voiceId },
        language: 'en',
        output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
      }),
    });
    if (!res.ok) throw new Error(`Cartesia ${res.status}: ${await res.text()}`);
    return { contentType: res.headers.get('content-type') ?? 'audio/mpeg', audio: new Uint8Array(await res.arrayBuffer()) };
  }
}

export class MockVoice implements VoiceService {
  readonly name = 'mock-voice';
  async tts() {
    return null;
  }
}
