// ── Plan definitions ───────────────────────────────────────────────────────────
// "Unlimited" does NOT exist. Every plan has soft limits + fair-use throttling.

export type PlanName = 'free' | 'pro' | 'enterprise';
export type Provider = 'pollinations' | 'openai' | 'stability' | 'gemini';

export interface PlanConfig {
  initialCredits: number;     // credits on account creation
  dailyRefill: number;        // credits added every 24 h
  maxDailyRequests: number;   // hard request ceiling per 24 h
  minIntervalMs: number;      // minimum ms between any two requests (throttle)
  imageProvider: Provider;    // default image provider for this plan
  textProvider: Provider;     // default text provider for this plan
}

export const PLANS: Record<PlanName, PlanConfig> = {
  free: {
    initialCredits:   100,
    dailyRefill:       20,
    maxDailyRequests:  30,
    minIntervalMs:   3000,   // 1 req / 3 s
    imageProvider: 'pollinations',
    textProvider:  'gemini',
  },
  pro: {
    initialCredits:  5_000,
    dailyRefill:       500,
    maxDailyRequests:  300,
    minIntervalMs:     500,   // 2 req / s
    imageProvider: 'openai',
    textProvider:  'openai',
  },
  enterprise: {
    initialCredits: 50_000,
    dailyRefill:     2_000,
    maxDailyRequests: 2_000,
    minIntervalMs:     100,   // 10 req / s
    imageProvider: 'openai',
    textProvider:  'openai',
  },
};

// ── Credit costs per tool ──────────────────────────────────────────────────────
export const TOOL_COSTS: Record<string, number> = {
  'image-generation': 5,
  'text-generation':  1,
  'enhance-prompt':   1,
};

// ── Size/dimension maps ────────────────────────────────────────────────────────
export const OPENAI_SIZES: Record<string, string> = {
  '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536',
  '4:3': '1024x1024', '3:4':  '1024x1024',
};
export const DALLE3_SIZES: Record<string, string> = {
  '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792',
  '4:3': '1024x1024', '3:4':  '1024x1024',
};
export const POLLINATIONS_DIMS: Record<string, { w: number; h: number }> = {
  '1:1': { w: 1024, h: 1024 }, '16:9': { w: 1344, h: 768  },
  '9:16': { w: 768, h: 1344  }, '4:3':  { w: 1024, h: 768  },
  '3:4':  { w: 768,  h: 1024 },
};

// ── Style suffix library ───────────────────────────────────────────────────────
export const STYLE_PROMPTS: Record<string, string> = {
  photorealistic: 'ultra photorealistic, 8K UHD, DSLR quality, natural lighting, hyper-detailed',
  anime:          'anime illustration, vibrant colors, cel shading, Studio Ghibli aesthetic',
  cinematic:      'cinematic photography, anamorphic lens, dramatic chiaroscuro, film grain, movie still',
  oilpainting:    'classical oil painting, impasto brushwork, rich textures, Rembrandt lighting',
  scifi:          'sci-fi concept art, cyberpunk aesthetic, neon lighting, blade runner atmosphere',
  watercolor:     'delicate watercolor painting, soft washes, transparent luminous layers',
  sketch:         'detailed pencil sketch, cross-hatching, graphite on paper, fine line art',
  fantasy:        'epic high-fantasy art, magical atmosphere, otherworldly lighting, artstation',
};
