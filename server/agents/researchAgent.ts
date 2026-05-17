import { modelRouter } from '../router/modelRouter.js';
import { memory } from '../memory/memoryManager.js';
import { globalEventBus } from '../events/eventBus.js';
import { createSafetyGuard } from '../safety/safetyGuard.js';
import type { ModelMessage } from '../router/types.js';

const SYSTEM_PROMPT = `You are a Research Agent. Analyze questions deeply and provide structured, evidence-based answers.

Always structure your response as:
## Summary
## Key Findings
## Evidence
## Conclusion`;

export interface ResearchResult {
  query:       string;
  summary:     string;
  keyFindings: string[];
  conclusion:  string;
  confidence:  'low' | 'medium' | 'high';
  tokenCount?: number;
}

type Depth = 'quick' | 'standard' | 'deep';

const DEPTH_TOKENS: Record<Depth, number> = { quick: 512, standard: 1024, deep: 4096 };

const emit = globalEventBus.createEmitter('research-agent');

export async function runResearchAgent(
  query: string,
  opts?: {
    userId?:    string;
    sessionId?: string;
    taskId?:    string;
    depth?:     Depth;
  }
): Promise<ResearchResult> {
  const depth     = opts?.depth ?? 'standard';
  const maxTokens = DEPTH_TOKENS[depth];
  const sessionId = opts?.sessionId ?? `research:${opts?.taskId ?? 'default'}`;

  emit('AGENT_STARTED', { query, depth }, { taskId: opts?.taskId, userId: opts?.userId });

  const guard = createSafetyGuard(
    { maxSteps: 5, totalTimeoutMs: 120_000 },
    { taskId: opts?.taskId, userId: opts?.userId }
  );
  guard.beginStep();
  const v = guard.checkStep();
  if (v) throw new Error(v.message);

  const history = await memory.getConversationHistory(sessionId);
  const messages: ModelMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

  if (history.length) {
    messages.push({
      role:    'system',
      content: `[Prior Research Context]\n${history.slice(-3).map(h => `${h.role}: ${h.content}`).join('\n')}`,
    });
  }

  messages.push({ role: 'user', content: `Research question: ${query}` });

  const response = await modelRouter.complete({
    messages, maxTokens, temperature: 0.3, userId: opts?.userId, taskId: opts?.taskId,
  });

  const text = response.content;

  const extract = (heading: string) => {
    const m = text.match(new RegExp(`##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=##|$)`, 'i'));
    return m?.[1]?.trim() ?? '';
  };

  const summary    = extract('Summary')      || text.slice(0, 400);
  const conclusion = extract('Conclusion')   || '';
  const rawFindings = extract('Key Findings');
  const keyFindings = rawFindings
    .split('\n')
    .filter(l => l.trim().match(/^[-*•]|\d+\./))
    .map(l => l.replace(/^[-*•\d.]\s*/, '').trim())
    .filter(Boolean);

  await memory.saveConversationTurn(sessionId, {
    role:      'assistant',
    content:   `Research: ${query}\n${summary}`,
    timestamp: Date.now(),
  });

  const result: ResearchResult = {
    query,
    summary,
    keyFindings: keyFindings.length ? keyFindings : [summary],
    conclusion:  conclusion || summary,
    confidence:  depth === 'deep' ? 'high' : depth === 'quick' ? 'low' : 'medium',
    tokenCount:  response.totalTokens,
  };

  emit('AGENT_COMPLETED', { query, confidence: result.confidence }, {
    taskId: opts?.taskId, userId: opts?.userId,
  });

  return result;
}
