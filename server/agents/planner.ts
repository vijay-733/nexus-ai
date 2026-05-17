// Planner Agent
// Takes a raw user task, calls an LLM, and returns an ordered PlanStep[].
// LLM must output compact JSON; if it fails or returns garbage we fall back
// to a single-step keyword-based plan so execution never stalls.

import { callOpenAIText, callGeminiText, callPollinationsText } from '../services/modelRouter.js';
import { logger }                                               from '../utils/logger.js';
import type { PlanStep }                                        from '../memory/sharedMemory.js';

const MAX_PLAN_STEPS   = 5;
const PLANNER_TIMEOUT  = 20_000;
const POLL_MODELS      = ['openai', 'mistral', 'llama'] as const;

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildPlanPrompt(task: string): string {
  return `You are an expert task planning agent. Decompose the user request into up to ${MAX_PLAN_STEPS} high-quality, concrete steps.

STEP TYPES:
  text  — writing, research, analysis, summarising, explaining, coding, strategy, data collection
  image — generating, drawing, or visualising any visual content

USER REQUEST: ${task}

PLANNING RULES:
- "task" field: detailed self-contained instruction for the worker agent (20-80 words)
- "description" field: short UI label for the step (5-10 words, for display only)
- "dependsOn": list step IDs whose output this step needs as context (empty array if independent)
- If the request needs only one step, return exactly one step with a rich task description
- Maximum ${MAX_PLAN_STEPS} steps; prefer fewer focused steps over many vague ones
- Only use type "image" for steps that genuinely produce a visual/image output
- Output ONLY valid compact JSON — no markdown fences, no explanation

OUTPUT FORMAT:
{"plan":[{"id":"1","type":"text","task":"Research and write a comprehensive overview of X, covering background, current trends, key challenges, and future directions with specific examples.","description":"Research X landscape","dependsOn":[]},{"id":"2","type":"text","task":"Synthesize the research from step 1 into an executive summary with actionable recommendations.","description":"Write executive summary","dependsOn":["1"]}]}`.trim();
}

// ── LLM call (OpenAI → Gemini → Pollinations rotation) ────────────────────────

async function llmPlan(task: string): Promise<string> {
  const prompt = buildPlanPrompt(task);
  const sys    = 'You are a planning agent. Output ONLY valid compact JSON. No markdown.';
  const ok     = process.env.OPENAI_API_KEY?.trim();
  const gk     = process.env.GEMINI_API_KEY?.trim();

  if (ok) return callOpenAIText(prompt, sys, ok);
  if (gk) return callGeminiText(prompt, sys, gk);

  // Free tier — Pollinations POST API, model rotation
  let lastErr: Error = new Error('planner: all LLM providers failed');
  for (const model of POLL_MODELS) {
    try {
      const result = await callPollinationsText(prompt, sys, model, PLANNER_TIMEOUT);
      if (result) return result;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      logger.warn('planner', `model=${model} failed: ${lastErr.message}`);
    }
  }
  throw lastErr;
}

// ── JSON parser — strips markdown fences, extracts first { } block ────────────

function parsePlan(raw: string): PlanStep[] | null {
  const cleaned = raw.replace(/```(?:json)?\n?/gi, '').replace(/```/g, '').trim();
  const match   = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as {
      plan?: Array<{ id: unknown; type: unknown; task: unknown; description?: unknown; dependsOn?: unknown[] }>;
    };
    if (!Array.isArray(parsed.plan) || parsed.plan.length === 0) return null;

    return parsed.plan.slice(0, MAX_PLAN_STEPS).map(s => ({
      id:          String(s.id),
      type:        s.type === 'image' ? ('image' as const) : ('text' as const),
      task:        String(s.task ?? '').trim(),
      description: s.description ? String(s.description).trim() : undefined,
      dependsOn:   Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : [],
      status:      'pending' as const,
    }));
  } catch {
    return null;
  }
}

// ── Keyword fallback ──────────────────────────────────────────────────────────

const IMAGE_KW = [
  'image', 'photo', 'draw', 'paint', 'render', 'illustration',
  'picture', 'sketch', 'visualize', 'generate a visual', 'create a visual',
  'logo', 'banner', 'thumbnail', 'wallpaper', 'portrait', 'landscape',
];

function fallbackPlan(task: string): PlanStep[] {
  const t    = task.toLowerCase();
  const type: PlanStep['type'] = IMAGE_KW.some(w => t.includes(w)) ? 'image' : 'text';
  return [{ id: '1', type, task, dependsOn: [], status: 'pending' }];
}

// ── Public ────────────────────────────────────────────────────────────────────

export async function createPlan(task: string): Promise<PlanStep[]> {
  logger.info('planner', `planning: "${task.slice(0, 100)}"`);

  try {
    const raw   = await llmPlan(task);
    const steps = parsePlan(raw);
    if (steps && steps.length > 0) {
      logger.info('planner', `plan ok: ${steps.length} step(s) → [${steps.map(s => `${s.id}:${s.type}`).join(', ')}]`);
      return steps;
    }
    logger.warn('planner', 'JSON parse failed — falling back to keyword plan');
  } catch (err) {
    logger.warn('planner', `LLM failed: ${err instanceof Error ? err.message : err} — using keyword fallback`);
  }

  const plan = fallbackPlan(task);
  logger.info('planner', `fallback plan: type=${plan[0].type}`);
  return plan;
}
