// Image generation service — calls the Express backend only.
// Provider priority (set in .env): OpenAI → Stability AI → Pollinations (free, no key needed).
// Gemini is NOT used for image generation — it's unreliable and quota-constrained.

export type ImageProvider = 'openai' | 'stability' | 'pollinations';

export type ImageQuality = 'standard' | 'large' | 'ultra';

export interface GenerateImageOptions {
  prompt: string;
  style?: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '3:4' | '4:3';
  seed?: number;
  quality?: ImageQuality;
}

export interface GeneratedImage {
  url: string;
  prompt: string;
  style: string;
  aspectRatio: string;
  seed: number;
  timestamp: number;
  revisedPrompt?: string;
  source: ImageProvider;
  warning?: string;
}

export async function generateImage(options: GenerateImageOptions): Promise<GeneratedImage> {
  const seed = options.seed ?? Math.floor(Math.random() * 999_999);

  let response: Response;
  try {
    response = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...options, seed }),
      signal: AbortSignal.timeout(120_000), // 2 min — Pollinations can be slow
    });
  } catch (err: unknown) {
    // Network-level failure = backend server not running
    if (err instanceof TypeError) {
      throw new Error(
        'Image server is offline.\n' +
        'Open a second terminal in the project folder and run:\n\n  npm run server'
      );
    }
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('Request timed out after 2 minutes. The image server is not responding.');
    }
    throw err;
  }

  const data = await response.json() as {
    image?: string;
    seed?: number;
    revisedPrompt?: string;
    provider?: string;
    warning?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error ?? `Server error ${response.status}`);
  }

  if (!data.image) {
    throw new Error('Server returned success but no image data. Check server logs.');
  }

  return {
    url: data.image,
    prompt: options.prompt,
    style: options.style ?? 'default',
    aspectRatio: options.aspectRatio ?? '1:1',
    seed: data.seed ?? seed,
    timestamp: Date.now(),
    revisedPrompt: data.revisedPrompt,
    source: (data.provider as ImageProvider) ?? 'pollinations',
    warning: data.warning,
  };
}

export async function enhancePrompt(prompt: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch('/api/enhance-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // Server offline — return local enhancement so the UI still works
    return `${prompt.trim()}, highly detailed, professional composition, stunning lighting, masterpiece`;
  }

  if (!response.ok) return prompt;
  const data = await response.json() as { enhanced?: string };
  return data.enhanced ?? prompt;
}

export async function getServerStatus(): Promise<{
  ok: boolean;
  imageProvider: string;
  hasOpenAI: boolean;
  hasStability: boolean;
  freeMode: boolean;
}> {
  try {
    const res = await fetch('/api/status', { signal: AbortSignal.timeout(5_000) });
    if (res.ok) return res.json();
  } catch { /* server offline */ }
  return { ok: false, imageProvider: 'offline', hasOpenAI: false, hasStability: false, freeMode: false };
}
