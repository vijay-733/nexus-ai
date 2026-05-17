import { toolRegistry, type ToolParams, type ToolResult } from './registry.js';
import {
  callOpenAIImage, callStabilityImage, callPollinations,
} from '../services/modelRouter.js';
import {
  STYLE_PROMPTS, OPENAI_SIZES, POLLINATIONS_DIMS,
} from '../utils/config.js';
import { logger } from '../utils/logger.js';

function enhancePrompt(prompt: string, style?: string): string {
  const suffix = style && STYLE_PROMPTS[style] ? `, ${STYLE_PROMPTS[style]}` : '';
  return `${prompt.trim()}${suffix}`;
}

async function run(p: ToolParams): Promise<ToolResult> {
  const enhanced    = enhancePrompt(p.prompt, p.style);
  const ratio       = p.aspectRatio ?? '1:1';
  const seed        = p.seed ?? Math.floor(Math.random() * 999_999);
  const provider    = p.provider as 'openai' | 'stability' | 'pollinations';

  logger.info('image-tool', `provider=${provider} ratio=${ratio} style=${p.style ?? 'none'}`);

  switch (provider) {
    case 'openai': {
      const key = process.env.OPENAI_API_KEY!;
      const size = OPENAI_SIZES[ratio] ?? '1024x1024';
      const { image, revisedPrompt } = await callOpenAIImage(enhanced, size, key);
      return {
        type: 'image', content: image, provider: 'openai', model: 'gpt-image-1',
        metadata: { seed, revisedPrompt, style: p.style, aspectRatio: ratio },
      };
    }

    case 'stability': {
      const key   = process.env.STABILITY_API_KEY!;
      const image = await callStabilityImage(enhanced, ratio, seed, key);
      return {
        type: 'image', content: image, provider: 'stability', model: 'stable-image-core',
        metadata: { seed, style: p.style, aspectRatio: ratio },
      };
    }

    case 'pollinations':
    default: {
      const dims  = POLLINATIONS_DIMS[ratio] ?? { w: 1024, h: 1024 };
      const image = await callPollinations(enhanced, dims.w, dims.h, seed);
      return {
        type: 'image', content: image, provider: 'pollinations', model: 'flux',
        metadata: { seed, style: p.style, aspectRatio: ratio },
      };
    }
  }
}

// Register on import
toolRegistry.register({
  name:        'image-generation',
  description: 'Generate images from text prompts. Supports styles and aspect ratios.',
  cost:        5,
  handler:     run,
});
