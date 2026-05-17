// Selects the best available AI provider for a given plan + tool type.
// Falls back down the chain when API keys are missing.
//
// Every external call accepts an optional AbortSignal so callers can impose
// both a per-call timeout AND an overall task deadline simultaneously.

import { PLANS, type PlanName, type Provider } from '../utils/config.js';
import { logger } from '../utils/logger.js';

export interface ProviderSet {
  image: Provider;
  text:  Provider;
}

export function resolveProviders(plan: PlanName): ProviderSet {
  const cfg        = PLANS[plan];
  const hasOpenAI  = Boolean(process.env.OPENAI_API_KEY?.trim());
  const hasStab    = Boolean(process.env.STABILITY_API_KEY?.trim());
  const hasGemini  = Boolean(process.env.GEMINI_API_KEY?.trim());

  let image: Provider = cfg.imageProvider;
  if (image === 'openai'    && !hasOpenAI) image = hasStab ? 'stability' : 'pollinations';
  if (image === 'stability' && !hasStab)   image = hasOpenAI ? 'openai' : 'pollinations';

  let text: Provider = cfg.textProvider;
  if (text === 'openai'  && !hasOpenAI) text = hasGemini ? 'gemini' : 'pollinations';
  if (text === 'gemini'  && !hasGemini) text = hasOpenAI ? 'openai' : 'pollinations';

  logger.debug('router', `plan=${plan} → image=${image} text=${text}`);
  return { image, text };
}

// ── Image providers ───────────────────────────────────────────────────────────

export async function callOpenAIImage(
  prompt: string, size: string, apiKey: string
): Promise<{ image: string; revisedPrompt?: string }> {
  let res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size, quality: 'high' }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    const code = err.error?.code ?? '';
    if (code === 'model_not_found' || res.status === 403 || res.status === 404) {
      const d3size = ['1024x1024','1792x1024','1024x1792'].includes(size) ? size : '1024x1024';
      res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: d3size, quality: 'hd', response_format: 'b64_json' }),
        signal: AbortSignal.timeout(60_000),
      });
    } else {
      throw new Error(err.error?.message ?? `OpenAI image error ${res.status}`);
    }
  }

  const data = await res.json() as {
    data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    error?: { message: string };
  };
  if (!res.ok) throw new Error(data.error?.message ?? `OpenAI ${res.status}`);

  const item = data.data?.[0];
  if (!item) throw new Error('OpenAI returned empty image response');

  return {
    image: item.b64_json ? `data:image/png;base64,${item.b64_json}` : (item.url ?? ''),
    revisedPrompt: item.revised_prompt,
  };
}

export async function callStabilityImage(
  prompt: string, aspectRatio: string, seed: number, apiKey: string
): Promise<string> {
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('aspect_ratio', aspectRatio);
  form.append('seed', String(seed % 4_294_967_295));
  form.append('output_format', 'png');

  const res  = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json() as { image?: string; errors?: string[] };
  if (!res.ok) throw new Error(data.errors?.join(', ') ?? `Stability ${res.status}`);
  if (!data.image) throw new Error('Stability returned no image');
  return `data:image/png;base64,${data.image}`;
}

export async function callPollinations(
  prompt: string, w: number, h: number, seed: number
): Promise<string> {
  const encoded = encodeURIComponent(prompt);
  const base    = `https://image.pollinations.ai/prompt/${encoded}?width=${w}&height=${h}&seed=${seed}&nologo=true`;

  // turbo = fast (< 10 s), flux = standard (up to 60 s), default = fallback
  const attempts: Array<[string, number]> = [
    [`${base}&model=turbo`, 35_000],
    [`${base}&model=flux`,  60_000],
    [base,                  45_000],
  ];

  let lastError = 'no response';
  for (const [url, timeoutMs] of attempts) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) { lastError = `HTTP ${res.status}`; continue; }
      const buf  = await res.arrayBuffer();
      const mime = res.headers.get('content-type') ?? 'image/jpeg';
      if (!mime.startsWith('image/')) { lastError = `unexpected content-type ${mime}`; continue; }
      return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
      continue;
    }
  }

  logger.warn('image', `Pollinations all attempts failed: ${lastError}`);
  throw new Error(`Image generation failed (${lastError}). Try again in a moment.`);
}

// ── Text providers ────────────────────────────────────────────────────────────

// Pollinations POST (OpenAI-compatible) — free-tier text fallback.
// Accepts an optional caller-supplied AbortSignal (e.g. overall task timeout);
// combined with per-call timeoutMs via AbortSignal.any so both constraints apply.
export async function callPollinationsText(
  prompt:       string,
  systemPrompt: string,
  model       = 'openai',
  timeoutMs   = 20_000,
  signal?:      AbortSignal,
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt.slice(0, 2_500) });
  messages.push({ role: 'user', content: prompt.slice(0, 6_000) });

  const callSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);

  const res = await fetch('https://text.pollinations.ai/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, seed: Math.floor(Math.random() * 99_999) }),
    signal: callSignal,
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`Pollinations ${res.status}: ${raw.slice(0, 200)}`);

  try {
    const json = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string }; text?: string }>;
      error?:   { message: string };
    };
    if (json.error) throw new Error(json.error.message);
    const content = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? '';
    if (content.trim()) return content.trim();
  } catch { /* fall through to raw text */ }

  if (raw.trim()) return raw.trim();
  throw new Error('Pollinations returned empty response');
}

export async function callOpenAIText(
  prompt: string, systemPrompt: string, apiKey: string, signal?: AbortSignal,
): Promise<string> {
  const callSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
    : AbortSignal.timeout(60_000);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:       'gpt-4o-mini',
      messages:    [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: prompt },
      ],
      max_tokens:  8192,
      temperature: 0.7,
    }),
    signal: callSignal,
  });
  const data = await res.json() as {
    choices?: Array<{ message: { content: string } }>;
    error?: { message: string };
  };
  if (!res.ok) throw new Error(data.error?.message ?? `OpenAI ${res.status}`);
  return data.choices?.[0]?.message?.content ?? '';
}

export async function callGeminiText(
  prompt: string, systemPrompt: string, apiKey: string, signal?: AbortSignal,
): Promise<string> {
  const callSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
    : AbortSignal.timeout(60_000);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents:           [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 8192,
          temperature:     0.7,
        },
      }),
      signal: callSignal,
    }
  );
  const data = await res.json() as {
    candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
    error?: { message: string };
  };
  if (!res.ok) throw new Error(data.error?.message ?? `Gemini ${res.status}`);
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}
