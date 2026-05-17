// All text / voice / transcription tool endpoints.
// Provider priority: Gemini → OpenAI → Pollinations POST (free, no key).
// Voice: Gemini TTS → OpenAI TTS → StreamElements free.

import { Router, type Request, type Response } from 'express';
import { callPollinationsText } from '../services/modelRouter.js';
import { logger } from '../utils/logger.js';

export const toolsRouter = Router();

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';
const TEXT_MODEL = 'gemini-2.5-flash';
const TTS_MODEL  = 'gemini-2.5-flash-preview-tts';

const gk = () => process.env.GEMINI_API_KEY?.trim() ?? '';
const ok = () => process.env.OPENAI_API_KEY?.trim() ?? '';

// ── Free fallback — Pollinations POST API ──────────────────────────────────────

const POLL_MODELS = ['openai', 'mistral', 'llama'] as const;

async function pollinationsPost(prompt: string, systemPrompt?: string): Promise<string> {
  let lastErr: Error = new Error('Pollinations unavailable');
  for (const model of POLL_MODELS) {
    try {
      const result = await callPollinationsText(prompt, systemPrompt ?? '', model, 25_000);
      if (result) return result;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      logger.warn('tools', `Pollinations POST model=${model} failed: ${lastErr.message}`);
    }
  }
  throw lastErr;
}

// Simulated streaming — takes the full text and sends it word-by-word so the
// chat UI still gets a live "typing" effect without real SSE from Pollinations.
async function simulateStream(
  text: string,
  send: (o: object) => void,
  done: () => void,
) {
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    send({ chunk: (i === 0 ? '' : ' ') + words[i] });
    if (i % 8 === 0) await new Promise(r => setTimeout(r, 25)); // micro-delay every 8 words
  }
  done();
}

// ── Paid provider helpers ──────────────────────────────────────────────────────

async function geminiText(prompt: string, systemPrompt?: string): Promise<string> {
  const r = await fetch(`${GEMINI_API}/${TEXT_MODEL}:generateContent?key=${gk()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(systemPrompt ? { system_instruction: { parts: [{ text: systemPrompt }] } } : {}),
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
  const d = await r.json() as {
    candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
    error?: { message: string };
  };
  if (!r.ok) throw new Error(d.error?.message ?? `Gemini ${r.status}`);
  return d.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function openaiText(prompt: string, systemPrompt?: string): Promise<string> {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini', max_tokens: 2048,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt },
      ],
    }),
  });
  const d = await r.json() as {
    choices?: Array<{ message: { content: string } }>;
    error?: { message: string };
  };
  if (!r.ok) throw new Error(d.error?.message ?? `OpenAI ${r.status}`);
  return d.choices?.[0]?.message?.content ?? '';
}

// ── Shared SSE pipe for Gemini / OpenAI streaming ─────────────────────────────
async function pipeSSE(
  body: ReadableStream<Uint8Array>,
  send: (obj: object) => void,
  done: () => void,
  provider: 'gemini' | 'openai',
) {
  const reader  = body.getReader();
  const decoder = new TextDecoder();
  let   buf     = '';
  while (true) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') { done(); return; }
      try {
        if (provider === 'gemini') {
          const p = JSON.parse(raw) as { candidates?: Array<{ content: { parts: Array<{ text: string }> } }> };
          const t = p.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          if (t) send({ chunk: t });
        } else {
          const p = JSON.parse(raw) as { choices?: Array<{ delta: { content?: string }; finish_reason?: string }> };
          if (p.choices?.[0]?.finish_reason === 'stop') { done(); return; }
          const t = p.choices?.[0]?.delta?.content ?? '';
          if (t) send({ chunk: t });
        }
      } catch { /* malformed SSE line */ }
    }
  }
  done();
}

// ── POST /api/tools/text ──────────────────────────────────────────────────────
toolsRouter.post('/text', async (req: Request, res: Response) => {
  const { prompt, systemPrompt } = req.body as { prompt?: string; systemPrompt?: string };
  if (!prompt?.trim()) { res.status(400).json({ error: 'prompt is required' }); return; }

  try {
    let text = '';
    if (gk())      { text = await geminiText(prompt, systemPrompt); }
    else if (ok()) { text = await openaiText(prompt, systemPrompt); }
    else           { text = await pollinationsPost(prompt, systemPrompt); }
    res.json({ text });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Generation failed';
    logger.error('tools/text', msg);
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/tools/chat — SSE streaming ──────────────────────────────────────
toolsRouter.post('/chat', async (req: Request, res: Response) => {
  const { history, message, systemPrompt } = req.body as {
    history: Array<{ role: string; content: string }>;
    message: string;
    systemPrompt?: string;
  };
  if (!message?.trim()) { res.status(400).json({ error: 'message is required' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (obj: object) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const done = ()            => { res.write('data: [DONE]\n\n'); res.end(); };

  try {
    if (gk()) {
      const contents = [
        ...history.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
        { role: 'user', parts: [{ text: message }] },
      ];
      const up = await fetch(`${GEMINI_API}/${TEXT_MODEL}:streamGenerateContent?key=${gk()}&alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(systemPrompt ? { system_instruction: { parts: [{ text: systemPrompt }] } } : {}),
          contents,
        }),
      });
      if (!up.ok || !up.body) {
        const e = await up.json().catch(() => ({})) as { error?: { message: string } };
        send({ error: e.error?.message ?? `Gemini ${up.status}` }); res.end(); return;
      }
      await pipeSSE(up.body, send, done, 'gemini');

    } else if (ok()) {
      const up = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ok()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini', stream: true, max_tokens: 2048,
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            ...history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
            { role: 'user', content: message },
          ],
        }),
      });
      if (!up.ok || !up.body) {
        const e = await up.json().catch(() => ({})) as { error?: { message: string } };
        send({ error: e.error?.message ?? `OpenAI ${up.status}` }); res.end(); return;
      }
      await pipeSSE(up.body, send, done, 'openai');

    } else {
      // Free tier — Pollinations GET + simulated streaming.
      // Embed system prompt inline so the model respects it. Filter error messages from history.
      const sysBlock = systemPrompt?.trim()
        ? `[SYSTEM: ${systemPrompt.trim().slice(0, 600)}]\n\n`
        : '';
      const cleanHistory = history
        .filter(m => !(m.role === 'assistant' && m.content.startsWith('**Error:**')))
        .slice(-8);
      const historyText = cleanHistory
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
        .join('\n');
      const fullPrompt = sysBlock + (historyText
        ? `${historyText}\nUser: ${message}\nAssistant:`
        : `User: ${message}\nAssistant:`);
      const text = await pollinationsPost(fullPrompt);
      await simulateStream(text, send, done);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Chat failed';
    logger.error('tools/chat', msg);
    send({ error: msg }); res.end();
  }
});

// ── POST /api/tools/sentiment ─────────────────────────────────────────────────
toolsRouter.post('/sentiment', async (req: Request, res: Response) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) { res.status(400).json({ error: 'text is required' }); return; }

  const jsonInstruction = 'Respond with ONLY raw JSON (no markdown, no code block): {"sentiment":"Positive|Negative|Neutral","score":<number -1.0 to 1.0>,"explanation":"<one sentence>"}';
  const userMsg = `Analyze the sentiment of this text: "${text.slice(0, 2_000)}"`;

  try {
    let raw = '';
    if (gk()) {
      const r = await fetch(`${GEMINI_API}/${TEXT_MODEL}:generateContent?key=${gk()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: jsonInstruction }] },
          contents: [{ parts: [{ text: userMsg }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });
      const d = await r.json() as { candidates?: Array<{ content: { parts: Array<{ text: string }> } }>; error?: { message: string } };
      if (!r.ok) throw new Error(d.error?.message ?? `Gemini ${r.status}`);
      raw = d.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    } else if (ok()) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ok()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: jsonInstruction }, { role: 'user', content: userMsg }],
        }),
      });
      const d = await r.json() as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
      if (!r.ok) throw new Error(d.error?.message ?? `OpenAI ${r.status}`);
      raw = d.choices?.[0]?.message?.content ?? '{}';
    } else {
      // Pollinations free — ask for raw JSON
      raw = await pollinationsPost(
        `${userMsg}. ${jsonInstruction}`,
        jsonInstruction,
      );
    }

    // Strip any markdown code fences the model may have added
    const stripped = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    const start    = stripped.indexOf('{');
    const end      = stripped.lastIndexOf('}');
    const jsonStr  = start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;
    res.json(JSON.parse(jsonStr));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Sentiment analysis failed';
    logger.error('tools/sentiment', msg);
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/tools/voice ─────────────────────────────────────────────────────
const SE_VOICE: Record<string, string> = {
  Kore:   'Kendra',
  Puck:   'Joey',
  Charon: 'Matthew',
  Fenrir: 'Brian',
  Zephyr: 'Amy',
};

toolsRouter.post('/voice', async (req: Request, res: Response) => {
  const { text, voiceName = 'Kore' } = req.body as { text?: string; voiceName?: string };
  if (!text?.trim()) { res.status(400).json({ error: 'text is required' }); return; }

  try {
    if (gk()) {
      // Gemini TTS
      const r = await fetch(`${GEMINI_API}/${TTS_MODEL}:generateContent?key=${gk()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        }),
      });
      const d = await r.json() as {
        candidates?: Array<{ content: { parts: Array<{ inlineData?: { data: string; mimeType: string } }> } }>;
        error?: { message: string };
      };
      if (!r.ok) throw new Error(d.error?.message ?? `Gemini TTS ${r.status}`);
      const audio = d.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!audio) throw new Error('Gemini TTS returned no audio');
      return res.json({ audio: `data:${audio.mimeType};base64,${audio.data}`, provider: 'gemini' });
    }

    if (ok()) {
      // OpenAI TTS
      const r = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ok()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'tts-1', input: text, voice: 'nova', response_format: 'mp3' }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as { error?: { message: string } };
        throw new Error(e.error?.message ?? `OpenAI TTS ${r.status}`);
      }
      const buf = await r.arrayBuffer();
      return res.json({ audio: `data:audio/mp3;base64,${Buffer.from(buf).toString('base64')}`, provider: 'openai' });
    }

    // StreamElements free TTS — no key, just fetch
    const seVoice  = SE_VOICE[voiceName] ?? 'Brian';
    const safeText = encodeURIComponent(text.trim().slice(0, 500));
    const seUrl    = `https://api.streamelements.com/kappa/v2/speech?voice=${seVoice}&text=${safeText}`;
    logger.debug('tools/voice', `StreamElements ${seUrl.slice(0, 80)}`);

    const r = await fetch(seUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'audio/mpeg, audio/*, */*',
        'Referer': 'https://streamelements.com/',
      },
    });

    if (!r.ok) {
      // StreamElements failed — return browser-TTS flag
      logger.warn('tools/voice', `StreamElements ${r.status} — falling back to browser TTS`);
      return res.json({ audio: null, browserTTS: true, text, provider: 'browser' });
    }

    const buf = await r.arrayBuffer();
    if (buf.byteLength < 100) {
      // Response too small to be real audio — browser TTS fallback
      return res.json({ audio: null, browserTTS: true, text, provider: 'browser' });
    }
    return res.json({ audio: `data:audio/mpeg;base64,${Buffer.from(buf).toString('base64')}`, provider: 'streamelements', voice: seVoice });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Voice generation failed';
    logger.error('tools/voice', msg);
    // Always fall back gracefully to browser TTS
    return res.json({ audio: null, browserTTS: true, text, provider: 'browser' });
  }
});

// ── POST /api/tools/transcribe ────────────────────────────────────────────────
toolsRouter.post('/transcribe', async (req: Request, res: Response) => {
  const { audio, mimeType = 'audio/mp3' } = req.body as { audio?: string; mimeType?: string };
  if (!audio?.trim()) { res.status(400).json({ error: 'audio is required' }); return; }

  try {
    if (gk()) {
      const r = await fetch(`${GEMINI_API}/${TEXT_MODEL}:generateContent?key=${gk()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { data: audio, mimeType } },
              { text: 'Transcribe this audio precisely. Label speakers if dialogue.' },
            ],
          }],
        }),
      });
      const d = await r.json() as { candidates?: Array<{ content: { parts: Array<{ text: string }> } }>; error?: { message: string } };
      if (!r.ok) throw new Error(d.error?.message ?? `Gemini ${r.status}`);
      return res.json({ transcript: d.candidates?.[0]?.content?.parts?.[0]?.text ?? '' });
    }

    if (ok()) {
      const formData = new FormData();
      formData.append('file', new Blob([Buffer.from(audio, 'base64')], { type: mimeType }), 'audio.mp3');
      formData.append('model', 'whisper-1');
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ok()}` },
        body: formData,
      });
      const d = await r.json() as { text?: string; error?: { message: string } };
      if (!r.ok) throw new Error(d.error?.message ?? `Whisper ${r.status}`);
      return res.json({ transcript: d.text ?? '' });
    }

    return res.json({ browserSTT: true, provider: 'browser' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Transcription failed';
    logger.error('tools/transcribe', msg);
    res.status(500).json({ error: msg });
  }
});
