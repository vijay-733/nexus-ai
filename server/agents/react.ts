// ReAct Agent — Think → Act → Observe loop.
//
// Each iteration:
//   THINK  — LLM reasons about current state and picks the next action
//   ACT    — Selected tool is executed
//   OBSERVE — Result is captured and appended to context
//
// Safety:
//   - maxSteps ceiling
//   - TOTAL_TIMEOUT_MS hard cap — enforced at EVERY await via taskSignal
//   - Per-step LLM timeout (STEP_THINK_MS) via AbortSignal.any
//   - Repeated-action loop detection
//   - Keyword fallback when Think LLM fails
//
// Observability: every step is logged and returned in the response.

import { toolRegistry }                                              from '../tools/registry.js';
import { checkCredits, recordUsage }                               from '../services/usageTracker.js';
import { resolveProviders, callOpenAIText,
         callGeminiText, callPollinationsText }                    from '../services/modelRouter.js';
import { agentMemory }                            from './memory.js';
import { store }                                  from '../utils/store.js';
import { logger }                                 from '../utils/logger.js';
import { globalEventBus }                         from '../events/eventBus.js';
import type { PlanName }                          from '../utils/config.js';

const emit = globalEventBus.createEmitter('react-agent');

// ── Public types ──────────────────────────────────────────────────────────────

export interface ReActStep {
  step:        number;
  thought:     string;
  action:      string;
  actionInput: string;
  observation: string;
  success:     boolean;
  durationMs:  number;
  timestamp:   number;
}

export interface ReActResult {
  success:      boolean;
  finalAnswer:  string;
  steps:        ReActStep[];
  totalSteps:   number;
  durationMs:   number;
  stoppedBy:    'finish' | 'maxSteps' | 'timeout' | 'loop' | 'error';
  error?:       string;
  usage: {
    creditsUsed:      number;
    creditsRemaining: number;
    plan:             string;
  };
}

export interface ReActCallbacks {
  onStep?:      (step: ReActStep)                                          => void;
  onStepStart?: (stepNum: number, thought: string, action: string, actionInput: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TOTAL_TIMEOUT_MS = 65_000;   // must complete before Cloudflare free tunnel's ~80s kill
const STEP_THINK_MS    = 15_000;   // per-model timeout; 3 models × 15s = 45s worst-case think budget
const MAX_STEPS_CAP    = 10;

// ── Think prompt builder ──────────────────────────────────────────────────────

function buildThinkPrompt(task: string, history: string, toolNames: string[]): string {
  const toolBlock = toolNames.map(n => `  - ${n}`).join('\n');
  return `You are an expert AI agent. Reason carefully and choose the best next action.

TASK: ${task}

AVAILABLE TOOLS:
${toolBlock}
  - finish  (when the task is fully complete — write the ENTIRE final answer as Action Input, not a reference to prior steps)

HISTORY:
${history || 'No steps taken yet.'}

TOOL SELECTION GUIDE:
- text-generation → writing, drafting, explaining, summarizing, coding, analysis
- research → factual lookups, current events, technical depth, data gathering
- web-fetch → retrieving live content from a specific URL
- memory-read / memory-write → storing or recalling persistent facts
- image-generation → only when the task explicitly asks for an image

ACTION INPUT QUALITY RULES:
- For text-generation: write a full, self-contained prompt with format, depth, and structure requirements (e.g. "Write a 1500-word blog post with ## headings covering X, Y, Z. Include code examples. Be thorough.")
- For research: specify exact questions, required sections, and output structure
- For finish: PASTE THE ACTUAL COMPLETE ANSWER here — never write "see above" or "as shown earlier"

Respond in EXACTLY this format:
Thought: [reasoning about current state and what to do next]
Action: [tool name or "finish"]
Action Input: [detailed prompt for the tool, OR the complete final answer if finishing]`.trim();
}

// ── Think response parser ─────────────────────────────────────────────────────
// Parses line-by-line to correctly handle multi-word labels like "Action Input:"
// without the regex lookahead swallowing subsequent label lines into the value.

function parseThink(raw: string): { thought: string; action: string; actionInput: string } {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let thought = '', action = '', actionInput = '';
  let current: 'thought' | 'action' | 'actionInput' | '' = '';

  for (const line of lines) {
    const t = line.trimStart();
    // Check "Action Input:" BEFORE "Action:" — the longer prefix must win
    if (/^Action Input:/i.test(t)) {
      current = 'actionInput';
      actionInput = t.slice('Action Input:'.length).trim();
    } else if (/^Action:/i.test(t)) {
      current = 'action';
      action = t.slice('Action:'.length).trim();
    } else if (/^Thought:/i.test(t)) {
      current = 'thought';
      thought = t.slice('Thought:'.length).trim();
    } else if (current) {
      // Continuation of the current label value (multi-line content)
      if      (current === 'thought')     thought     += '\n' + line;
      else if (current === 'action')      action      += '\n' + line;
      else if (current === 'actionInput') actionInput += '\n' + line;
    }
  }

  thought     = thought.trim();
  action      = action.trim();
  actionInput = actionInput.trim();

  const rawAction = (action || 'finish').replace(/^["']|["']$/g, '').trim().toLowerCase();
  let cleanAction = rawAction
    // handle underscore/space variants of known tools
    .replace(/^text[_\s]gen(?:eration)?$/,              'text-generation')
    .replace(/^image[_\s]gen(?:eration)?$/,             'image-generation')
    // common LLM synonyms → correct tool names
    .replace(/^(write|generate|compose|draft|create)$/,            'text-generation')
    .replace(/^(search|find|lookup|browse|web[-_\s]search)$/,      'research')
    .replace(/^web[-_\s]fetch$/,                                    'web-fetch')
    // common finish synonyms
    .replace(/^(done|complete|final|answer|stop|end|output|respond|reply)$/, 'finish');

  // Hard catch-all: if the action still isn't a registered tool name, remap it
  // rather than letting it hit "Unknown tool" and fail the step.
  const VALID_ACTIONS = new Set([
    'text-generation', 'image-generation', 'research', 'web-fetch',
    'memory-read', 'memory-write', 'memory-delete', 'finish',
  ]);
  if (!VALID_ACTIONS.has(cleanAction)) {
    const looksLikeImage = /\b(image|photo|picture|draw|paint|render|visual|illustrat|portrait|landscape|icon|logo|banner)\b/.test(cleanAction + ' ' + actionInput);
    cleanAction = looksLikeImage ? 'image-generation' : 'text-generation';
  }

  return {
    thought:     thought || raw.slice(0, 150),
    action:      cleanAction,
    actionInput: actionInput || thought,
  };
}

// ── Think provider ────────────────────────────────────────────────────────────
// Passes both a per-step timeout AND the overall task deadline signal.

async function think(prompt: string, overallSignal?: AbortSignal): Promise<string> {
  const gk  = process.env.GEMINI_API_KEY?.trim();
  const ok  = process.env.OPENAI_API_KEY?.trim();
  const sys = `You are an expert AI agent executing a task step by step. Follow the output format EXACTLY.

REQUIRED FORMAT — every response MUST contain all three labeled lines:
Thought: [your analysis of the current state and reasoning for the next action]
Action: [one tool name OR the word "finish"]
Action Input: [a detailed, specific prompt for the tool — OR the complete final answer when finishing]

CRITICAL RULES:
1. "Action Input:" MUST start on its own line, never inline with "Action:"
2. When Action is "finish": write the ENTIRE final answer in Action Input — never reference prior steps with phrases like "see above" or "as provided" — copy and include all relevant content directly
3. When Action is a tool: write a thorough, self-contained prompt that specifies format, structure, depth, and any requirements
4. Never truncate — write complete content in Action Input
5. For content tasks (blog posts, articles, code): if you already have the content from a prior step, copy it verbatim into Action Input when finishing`;

  if (ok) return callOpenAIText(prompt.slice(0, 4_000), sys, ok, overallSignal);
  if (gk) return callGeminiText(prompt.slice(0, 4_000), sys, gk, overallSignal);

  const MODELS = ['openai', 'mistral', 'llama'] as const;
  let lastErr: Error = new Error('think: all providers failed');
  for (const model of MODELS) {
    // Stop trying if overall deadline is already past
    if (overallSignal?.aborted) throw new Error('Task deadline exceeded');
    try {
      const result = await callPollinationsText(
        prompt, sys, model, STEP_THINK_MS, overallSignal,
      );
      if (result) return result;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      // Propagate only when the OVERALL deadline fired — per-model TimeoutError has name='TimeoutError'
      // and its message contains "aborted", which must NOT be treated as the overall deadline.
      if (overallSignal?.aborted) throw new Error('Task deadline exceeded');
      logger.warn('react/think', `model=${model} failed: ${lastErr.message}`);
    }
  }
  throw lastErr;
}

// ── Keyword fallback ──────────────────────────────────────────────────────────

function guessAction(task: string): string {
  const kw = ['image', 'photo', 'draw', 'paint', 'render', 'illustration',
              'picture', 'sketch', 'visualize', 'generate a visual'];
  return kw.some(w => task.toLowerCase().includes(w)) ? 'image-generation' : 'text-generation';
}

// ── Main ReAct loop ───────────────────────────────────────────────────────────

export async function runReAct(
  userId:       string,
  task:         string,
  maxSteps:     number = 5,
  taskSignal?:  AbortSignal,
  callbacks?:   ReActCallbacks,
): Promise<ReActResult> {
  const t0         = Date.now();
  const safeMax    = Math.min(maxSteps, MAX_STEPS_CAP);
  const steps:     ReActStep[] = [];
  let   credits    = 0;
  let   finalAnswer = '';
  let   stoppedBy: ReActResult['stoppedBy'] = 'finish';
  const seen       = new Set<string>();

  // Combine caller's deadline with our own total timeout
  const loopSignal = taskSignal
    ? AbortSignal.any([taskSignal, AbortSignal.timeout(TOTAL_TIMEOUT_MS)])
    : AbortSignal.timeout(TOTAL_TIMEOUT_MS);

  const user      = store.users.findById(userId)!;
  const providers = resolveProviders(user.plan as PlanName);
  const toolNames = toolRegistry.list().map(t => t.name);

  logger.info('react', `START user=${userId} task="${task.slice(0, 80)}" maxSteps=${safeMax}`);
  emit('AGENT_STARTED', { userId, task, mode: 'react', maxSteps: safeMax }, { userId });

  for (let n = 1; n <= safeMax; n++) {

    // ── Safety: deadline check ───────────────────────────────────────────────
    if (loopSignal.aborted) {
      logger.warn('react', `deadline at step ${n}`);
      stoppedBy   = 'timeout';
      finalAnswer = steps.at(-1)?.observation ?? 'Task deadline exceeded.';
      break;
    }

    const stepT0 = Date.now();

    // ── Build history string ─────────────────────────────────────────────────
    const history = steps.map(s =>
      `Step ${s.step}:\n  Thought: ${s.thought}\n  Action: ${s.action}\n  Input: ${s.actionInput.slice(0, 200)}\n  Observation: ${s.observation.slice(0, 500)}`
    ).join('\n\n');

    // ── THINK ────────────────────────────────────────────────────────────────
    let thought = '', action = '', actionInput = '';
    try {
      const raw = await think(buildThinkPrompt(task, history, toolNames), loopSignal);
      ({ thought, action, actionInput } = parseThink(raw));
      logger.info('react', `[${n}] THINK thought="${thought.slice(0, 100)}"`);
      logger.info('react', `[${n}] ACT   action=${action} input="${actionInput.slice(0, 80)}"`);
    } catch (err) {
      // Use loopSignal.aborted to detect the overall deadline — not error message strings,
      // which incorrectly match per-model TimeoutError ("The operation was aborted due to timeout").
      if (loopSignal.aborted) {
        stoppedBy   = 'timeout';
        finalAnswer = steps.at(-1)?.observation ?? 'Task deadline exceeded.';
        break;
      }

      // Think failed but task has prior steps — use last observation as answer
      if (steps.length > 0) {
        thought     = 'Think step failed — using last observation as final answer.';
        action      = 'finish';
        actionInput = steps.at(-1)!.observation;
      } else {
        // First step and Think failed — use keyword fallback
        thought     = 'Think step failed — using keyword fallback.';
        action      = guessAction(task);
        actionInput = task;
      }
      logger.warn('react', `[${n}] THINK failed: ${err instanceof Error ? err.message : err}`);
    }

    // ── Safety: loop detection ───────────────────────────────────────────────
    const actionKey = `${action}::${actionInput.slice(0, 120)}`;
    if (seen.has(actionKey)) {
      logger.warn('react', `[${n}] loop detected — stopping`);
      stoppedBy   = 'loop';
      finalAnswer = steps.at(-1)?.observation ?? 'Loop detected.';
      break;
    }
    seen.add(actionKey);

    // Notify client that a step is starting so it can show a spinner
    callbacks?.onStepStart?.(n, thought, action, actionInput);

    // ── FINISH ───────────────────────────────────────────────────────────────
    if (action === 'finish') {
      const lastObs = steps.at(-1)?.observation ?? '';
      // If the LLM wrote a short reference ("See above", "As shown") instead of
      // the actual content, prefer the last tool observation which has the real output.
      finalAnswer = actionInput.length >= 200
        ? actionInput
        : lastObs.length > actionInput.length
          ? lastObs
          : actionInput || lastObs || 'Task complete.';
      stoppedBy   = 'finish';
      const finishStep: ReActStep = {
        step: n, thought, action: 'finish', actionInput,
        observation: 'Task marked complete by agent.',
        success: true, durationMs: Date.now() - stepT0, timestamp: Date.now(),
      };
      steps.push(finishStep);
      callbacks?.onStep?.(finishStep);
      logger.info('react', `[${n}] FINISH "${finalAnswer.slice(0, 80)}"`);
      break;
    }

    // ── ACT & OBSERVE ────────────────────────────────────────────────────────
    const toolDef = toolRegistry.get(action);
    let observation = '';
    let stepSuccess = false;

    if (!toolDef) {
      observation = `Unknown tool "${action}". Available: ${toolNames.join(', ')}.`;
      logger.warn('react', `[${n}] tool not found: ${action}`);
    } else {
      const creditCheck = checkCredits(userId, action, true);
      if (!creditCheck.allowed) {
        // Credits exhausted — wrap up with whatever we have so far
        finalAnswer = steps.at(-1)?.observation ?? 'Credit limit reached.';
        stoppedBy   = 'error';
        logger.warn('react', `[${n}] credits blocked — stopping loop`);
        steps.push({
          step: n, thought, action, actionInput,
          observation: `Blocked: ${creditCheck.reason}`,
          success: false, durationMs: Date.now() - stepT0, timestamp: Date.now(),
        });
        break;
      } else {
        try {
          const provider = action === 'image-generation' ? providers.image : providers.text;
          const result   = await toolDef.handler({ prompt: actionInput, provider });
          observation    = result.type === 'text'
            ? result.content.slice(0, 8_000)   // full blog posts / reports fit in 8k chars
            : `[Image generated via ${result.provider}]`;
          stepSuccess    = true;
          credits       += toolDef.cost;
          recordUsage(userId, action, provider, 'success', Date.now() - stepT0, actionInput);

          agentMemory.push(userId, { role: 'user',      content: actionInput,  tool: action, timestamp: Date.now() });
          agentMemory.push(userId, { role: 'assistant', content: observation,  tool: action, timestamp: Date.now() });
        } catch (err) {
          if (loopSignal.aborted) {
            stoppedBy   = 'timeout';
            finalAnswer = steps.at(-1)?.observation ?? 'Task deadline exceeded.';
            logger.warn('react', `[${n}] tool ${action} aborted by deadline`);
            break;
          }
          const msg   = err instanceof Error ? err.message : 'Tool execution failed';
          observation = `Error: ${msg}`;
          recordUsage(userId, action, action === 'image-generation' ? providers.image : providers.text, 'failed', Date.now() - stepT0, actionInput);
          logger.error('react', `[${n}] tool ${action} failed: ${msg}`);
        }
      }
    }

    logger.info('react', `[${n}] OBSERVE "${observation.slice(0, 120)}"`);
    const reactStep: ReActStep = {
      step: n, thought, action, actionInput, observation,
      success: stepSuccess, durationMs: Date.now() - stepT0, timestamp: Date.now(),
    };
    steps.push(reactStep);
    callbacks?.onStep?.(reactStep);

    if (n === safeMax) {
      finalAnswer = observation;
      stoppedBy   = 'maxSteps';
    }
  }

  const updUser = store.users.findById(userId)!;
  const dur     = Date.now() - t0;
  logger.info('react', `DONE steps=${steps.length} credits=${credits} dur=${dur}ms stoppedBy=${stoppedBy}`);
  const anySuccess = steps.some(s => s.success);
  if (anySuccess) {
    emit('AGENT_COMPLETED', { userId, steps: steps.length, durationMs: dur, stoppedBy }, { userId });
  } else {
    emit('AGENT_FAILED', { userId, steps: steps.length, durationMs: dur, stoppedBy }, { userId });
  }

  return {
    success:      steps.some(s => s.success),
    finalAnswer,
    steps,
    totalSteps:   steps.length,
    durationMs:   dur,
    stoppedBy,
    usage: {
      creditsUsed:      credits,
      creditsRemaining: updUser.credits,
      plan:             updUser.plan,
    },
  };
}
