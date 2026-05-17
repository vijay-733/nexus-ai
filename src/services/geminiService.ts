import { GoogleGenAI, Modality, Type } from "@google/genai";

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

type GContent = { role: 'user' | 'model'; parts: Array<{ text: string }> };

function getAPIKey(): string {
  const envKey = process.env.GEMINI_API_KEY as string | undefined;
  if (envKey && envKey.trim() !== '' && envKey !== 'undefined') return envKey.trim();
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('NEXUS_GEMINI_KEY');
    if (stored && stored.trim()) return stored.trim();
  }
  return '';
}

export function hasAPIKey(): boolean {
  return getAPIKey().length > 10;
}

export function setAPIKey(key: string): void {
  if (typeof window === 'undefined') return;
  const k = key.trim();
  if (k) localStorage.setItem('NEXUS_GEMINI_KEY', k);
  else localStorage.removeItem('NEXUS_GEMINI_KEY');
}

export function clearAPIKey(): void {
  if (typeof window !== 'undefined') localStorage.removeItem('NEXUS_GEMINI_KEY');
}

function client(): GoogleGenAI {
  const key = getAPIKey();
  if (!key) throw new Error('API_KEY_MISSING');
  return new GoogleGenAI({ apiKey: key });
}

function toGContents(history: ChatMessage[], newMessage?: string): GContent[] {
  const contents: GContent[] = history.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));
  if (newMessage) contents.push({ role: 'user', parts: [{ text: newMessage }] });
  return contents;
}

// --- Text models ---
const TEXT_MODEL = 'gemini-2.5-flash';
const IMAGE_MODEL = 'gemini-2.0-flash-preview-image-generation';
const IMAGE_MIRROR_MODEL = 'gemini-2.0-flash-preview-image-generation';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

export const geminiService = {
  // Single-shot text generation
  async generateText(prompt: string, systemInstruction?: string): Promise<string> {
    const ai = client();
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: { systemInstruction },
    });
    return response.text ?? '';
  },

  // Streaming text generation — yields chunks as they arrive
  async *streamText(prompt: string, systemInstruction?: string): AsyncGenerator<string> {
    const ai = client();
    const stream = ai.models.generateContentStream({
      model: TEXT_MODEL,
      contents: prompt,
      config: { systemInstruction },
    });
    for await (const chunk of await stream) {
      yield chunk.text ?? '';
    }
  },

  // Multi-turn chat — single response
  async sendChatMessage(history: ChatMessage[], newMessage: string, systemInstruction?: string): Promise<string> {
    const ai = client();
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contents: toGContents(history, newMessage) as any,
      config: { systemInstruction },
    });
    return response.text ?? '';
  },

  // Multi-turn chat — streaming
  async *streamChatMessage(history: ChatMessage[], newMessage: string, systemInstruction?: string): AsyncGenerator<string> {
    const ai = client();
    const stream = ai.models.generateContentStream({
      model: TEXT_MODEL,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contents: toGContents(history, newMessage) as any,
      config: { systemInstruction },
    });
    for await (const chunk of await stream) {
      yield chunk.text ?? '';
    }
  },

  // Image generation (Gemini fallback — used when backend/OpenAI is unavailable)
  async generateImage(prompt: string, _aspectRatio: '1:1' | '16:9' | '9:16' | '3:4' | '4:3' = '1:1'): Promise<string> {
    try {
      const ai = client();
      const response = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config: { responseModalities: ['IMAGE', 'TEXT'] } as any,
      });
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
      if (response.candidates?.[0]?.finishReason === 'SAFETY') {
        throw new Error('Neural filters blocked this visual. Please refine your intent.');
      }
      throw new Error('The neural field failed to resolve an image. (Empty response)');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Synthesis failed.';
      if (msg.toLowerCase().includes('quota') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        throw new Error('NEURAL_QUOTA_EXHAUSTED: Daily synthesis limit reached on Gemini free tier. Add OpenAI key for unlimited generations.');
      }
      throw new Error(msg);
    }
  },

  async generateImageMirror(prompt: string, aspectRatio: '1:1' | '16:9' | '9:16' | '3:4' | '4:3' = '1:1'): Promise<string> {
    return this.generateImage(prompt, aspectRatio);
  },

  // Text-to-speech
  async generateVoice(text: string, voiceName: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr' = 'Kore'): Promise<string> {
    const ai = client();
    const response = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    });
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) return `data:audio/wav;base64,${base64Audio}`;
    throw new Error('No voice data returned from model');
  },

  // Audio transcription
  async transcribeAudio(base64Audio: string, mimeType: string): Promise<string> {
    const ai = client();
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: {
        parts: [
          { inlineData: { data: base64Audio, mimeType } },
          { text: 'Transcribe this audio precisely. Label speakers if it is a dialogue.' },
        ],
      },
    });
    return response.text ?? '';
  },

  // Structured sentiment analysis
  async analyzeSentiment(text: string): Promise<{ sentiment: string; score: number; explanation: string }> {
    const ai = client();
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: `Analyze the sentiment of the following text: "${text}"`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sentiment: { type: Type.STRING, description: 'Positive, Negative, or Neutral' },
            score: { type: Type.NUMBER, description: 'Score from -1.0 to 1.0' },
            explanation: { type: Type.STRING },
          },
          required: ['sentiment', 'score', 'explanation'],
        },
      },
    });
    return JSON.parse(response.text ?? '{}');
  },
};
