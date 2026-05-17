// All AI calls go through the Express backend — no API keys in the browser.

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const BASE = '/api/tools';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res  = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data;
}

export const toolService = {
  async generateText(prompt: string, systemPrompt?: string): Promise<string> {
    const { text } = await post<{ text: string }>('/text', { prompt, systemPrompt });
    return text;
  },

  async *streamChatMessage(
    history: ChatMessage[],
    message: string,
    systemPrompt?: string,
  ): AsyncGenerator<string> {
    const res = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history, message, systemPrompt }),
    });

    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: 'Chat failed' })) as { error?: string };
      throw new Error(err.error ?? 'Chat request failed');
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6);
        if (raw === '[DONE]') return;
        try {
          const parsed = JSON.parse(raw) as { chunk?: string; error?: string };
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.chunk) yield parsed.chunk;
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  },

  async analyzeSentiment(
    text: string,
  ): Promise<{ sentiment: 'Positive' | 'Negative' | 'Neutral'; score: number; explanation: string }> {
    return post('/sentiment', { text });
  },

  async generateVoice(text: string, voiceName = 'Kore'): Promise<string> {
    const data = await post<{ audio: string | null; browserTTS?: boolean; text?: string }>('/voice', { text, voiceName });
    if (data.audio) return data.audio;
    if (data.browserTTS && typeof window !== 'undefined') {
      const speakText = data.text ?? text;
      // Distinct pitch/rate per character — makes all 5 voices sound clearly different
      const STYLES: Record<string, { pitch: number; rate: number; preferFemale: boolean }> = {
        Kore:   { pitch: 1.0,  rate: 1.0,  preferFemale: true  },
        Puck:   { pitch: 1.3,  rate: 1.12, preferFemale: false },
        Charon: { pitch: 0.65, rate: 0.88, preferFemale: false },
        Fenrir: { pitch: 0.85, rate: 0.96, preferFemale: false },
        Zephyr: { pitch: 1.2,  rate: 1.08, preferFemale: true  },
      };
      const style = STYLES[voiceName] ?? STYLES['Kore'];
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(speakText);
      utt.pitch = style.pitch;
      utt.rate  = style.rate;
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const en = voices.filter(v => v.lang.startsWith('en'));
        const femPat = /female|woman|zira|susan|hazel|victoria|samantha|karen|moira|fiona/i;
        const malPat = /male|man|david|mark|fred|daniel|james|george|rishi|tom|alex/i;
        const matched = en.filter(v => style.preferFemale ? femPat.test(v.name) : malPat.test(v.name));
        if (matched.length > 0) utt.voice = matched[0];
        else if (en.length > 0) utt.voice = en[style.preferFemale ? 0 : Math.min(1, en.length - 1)];
      }
      window.speechSynthesis.speak(utt);
      return `browser-tts:${speakText}`;
    }
    throw new Error('Voice generation failed — no audio returned');
  },

  async transcribeAudio(audio: string, mimeType: string): Promise<string> {
    const data = await post<{ transcript?: string; browserSTT?: boolean }>('/transcribe', { audio, mimeType });
    if (data.transcript) return data.transcript;
    if (data.browserSTT) return 'BROWSER_STT_REQUIRED';
    throw new Error('Transcription failed — no result returned');
  },
};
