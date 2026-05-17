import type { ModelMessage } from '../router/types.js';
import { toolVisibility } from './toolVisibility.js';
import { memory } from '../memory/memoryManager.js';
import { globalEventBus } from '../events/eventBus.js';

export interface ContextConfig {
  maxTokenBudget: number;
  memoryNamespaces: string[];
  systemPrompt?: string;
  constraints?: string[];
  includeTools: boolean;
  userId?: string;
  sessionId?: string;
  taskId?: string;
  role?: string;
  permissions?: string[];
  recoveryContext?: string;
}

export interface BuiltContext {
  messages: ModelMessage[];
  tokenEstimate: number;
  injectedMemoryCount: number;
  visibleToolCount: number;
  truncated: boolean;
  budget: { total: number; used: number; remaining: number };
}

const CHARS_PER_TOKEN = 4;

function est(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

const emit = globalEventBus.createEmitter('context-engine');

export class ContextEngine {
  async build(
    userMessage: string,
    history: ModelMessage[],
    config: ContextConfig
  ): Promise<BuiltContext> {
    let budget = config.maxTokenBudget;
    const messages: ModelMessage[] = [];
    let injectedMemoryCount = 0;
    let truncated = false;

    // ── 1. System prompt ─────────────────────────────────────────────────────
    const systemParts: string[] = [];
    if (config.systemPrompt) {
      systemParts.push(config.systemPrompt);
    }

    // ── 2. Constraints ───────────────────────────────────────────────────────
    if (config.constraints?.length) {
      systemParts.push(
        '\n[Operational Constraints]\n' + config.constraints.map(c => `• ${c}`).join('\n')
      );
    }

    // ── 3. Recovery context injection ────────────────────────────────────────
    if (config.recoveryContext) {
      systemParts.push(`\n[Recovery Context]\n${config.recoveryContext}`);
    }

    // ── 4. Tool visibility ───────────────────────────────────────────────────
    const visibleTools = config.includeTools
      ? toolVisibility.getVisibleTools({
          role:        config.role,
          userId:      config.userId,
          taskId:      config.taskId,
          permissions: config.permissions,
        })
      : [];

    if (visibleTools.length) {
      systemParts.push(
        '\n[Available Tools]\n' +
        visibleTools.map(t => {
          const flags = [
            t.requiresApproval ? '⚠ requires-approval' : '',
            t.sandbox          ? '🔒 sandbox'           : '',
          ].filter(Boolean).join(' ');
          return `• ${t.name}: ${t.description}${flags ? ` [${flags}]` : ''}`;
        }).join('\n')
      );
    }

    const systemContent = systemParts.join('\n').trim();
    const systemTokens  = est(systemContent);
    budget -= systemTokens;
    messages.push({ role: 'system', content: systemContent });

    // ── 5. Memory injection (newest last, budget-capped) ─────────────────────
    if (config.memoryNamespaces.length && budget > 500) {
      const memPieces: string[] = [];
      for (const ns of config.memoryNamespaces) {
        const records = await memory.query({
          namespace: ns,
          userId:    config.userId,
          sessionId: config.sessionId,
          taskId:    config.taskId,
          limit:     20,
        });
        for (const rec of records) {
          const val  = typeof rec.value === 'string' ? rec.value : JSON.stringify(rec.value);
          const line = `[${ns}/${rec.key}] ${val}`;
          const tok  = est(line);
          if (budget - tok < 500) break;
          memPieces.push(line);
          budget -= tok;
          injectedMemoryCount++;
        }
      }
      if (memPieces.length) {
        messages.push({ role: 'system', content: '[Relevant Memory]\n' + memPieces.join('\n') });
      }
    }

    // ── 6. History (newest-first truncation to fill 60% of remaining budget) ──
    const histBudget  = Math.floor(budget * 0.65);
    let histUsed      = 0;
    const histSlice: ModelMessage[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i]!;
      const tok = est(msg.content);
      if (histUsed + tok > histBudget) { truncated = true; break; }
      histUsed += tok;
      histSlice.unshift(msg);
    }
    messages.push(...histSlice);
    budget -= histUsed;

    // ── 7. Current user message ───────────────────────────────────────────────
    messages.push({ role: 'user', content: userMessage });
    budget -= est(userMessage);

    const used = config.maxTokenBudget - budget;

    emit('CONTEXT_BUILT', {
      injectedMemoryCount,
      visibleToolCount: visibleTools.length,
      tokenEstimate: used,
      truncated,
      userId: config.userId,
      taskId: config.taskId,
    });

    return {
      messages,
      tokenEstimate:      used,
      injectedMemoryCount,
      visibleToolCount:   visibleTools.length,
      truncated,
      budget: { total: config.maxTokenBudget, used, remaining: budget },
    };
  }
}

export const contextEngine = new ContextEngine();
