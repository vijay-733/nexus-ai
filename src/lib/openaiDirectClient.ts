// Calls OpenAI API directly from the browser — no backend needed.
// Used when nexus_openai_key is set in localStorage.
// Streams gpt-4o-mini responses token-by-token into NormalizedStep updates.

import type { AgentRunResult } from './api';
import type { NormalizedStep } from '../store/appStore';

export interface DirectStreamCallbacks {
  onStep:  (step: NormalizedStep) => void;
  onDone:  (result: AgentRunResult) => void;
  onError: (error: string) => void;
}

const SYSTEM_PROMPT = `You are an expert AI assistant. Produce comprehensive, well-structured responses.

FORMAT: Use ## headings, **bold** for key terms, bullet/numbered lists, and fenced code blocks with language tags.
QUALITY: Be specific and concrete. Explain the "why". Support claims with examples.
DEPTH: Match the complexity of the request — brief questions get concise answers, complex tasks get thorough coverage.
END: Always close with a "## Key Takeaways" section with 2-4 actionable bullet points.`;

export function getOpenAIKey(): string | null {
  return localStorage.getItem('nexus_openai_key')?.trim() || null;
}

export function streamOpenAIDirect(
  task: string,
  callbacks: DirectStreamCallbacks,
): () => void {
  const key = getOpenAIKey();
  if (!key) {
    callbacks.onError(
      'No OpenAI API key found. Go to Settings → API Keys and paste your key, then Save Changes.',
    );
    return () => {};
  }

  const ac        = new AbortController();
  const startedAt = Date.now();
  const STEP_ID   = 'direct-openai-1';

  callbacks.onStep({
    stepId:    STEP_ID,
    type:      'text',
    task:      task.slice(0, 80),
    status:    'running',
    thought:   'Sending request to GPT-4o mini…',
    action:    'text-generation',
    agentType: 'direct',
    provider:  'openai',
  });

  (async () => {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method:  'POST',
        signal:  ac.signal,
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model:       'gpt-4o-mini',
          stream:      true,
          max_tokens:  8192,
          temperature: 0.7,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user',   content: task },
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as {
          error?: { message?: string; code?: string };
        };
        const msg = body.error?.message ?? `OpenAI API returned ${res.status}`;
        throw new Error(
          res.status === 401
            ? `Invalid API key. Check your OpenAI key in Settings → API Keys. (${msg})`
            : res.status === 429
            ? `Rate limit or quota exceeded. Check your OpenAI account. (${msg})`
            : msg,
        );
      }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText  = '';
      let buf       = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const json = t.slice(5).trim();
          if (!json || json === '[DONE]') continue;

          try {
            const chunk = JSON.parse(json) as {
              choices?: Array<{
                delta?:        { content?: string };
                finish_reason?: string | null;
              }>;
              error?: { message: string };
            };

            if (chunk.error) throw new Error(chunk.error.message);

            const text = chunk.choices?.[0]?.delta?.content ?? '';
            if (text) {
              fullText += text;
              callbacks.onStep({
                stepId:    STEP_ID,
                type:      'text',
                task:      task.slice(0, 80),
                content:   fullText,
                status:    'running',
                action:    'text-generation',
                agentType: 'direct',
                provider:  'openai',
              });
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      decoder.decode(); // flush

      if (!fullText) throw new Error('OpenAI returned an empty response. Try again.');

      const durationMs = Date.now() - startedAt;

      callbacks.onStep({
        stepId:    STEP_ID,
        type:      'text',
        task:      task.slice(0, 80),
        content:   fullText,
        status:    'done',
        action:    'text-generation',
        agentType: 'direct',
        provider:  'openai',
        durationMs,
      });

      callbacks.onDone({
        success:     true,
        finalAnswer: fullText,
        durationMs,
        usage: { creditsUsed: 0, creditsRemaining: 9999, plan: 'openai-direct' },
      });

    } catch (err) {
      if (ac.signal.aborted) return;
      const msg = err instanceof Error ? err.message : 'OpenAI request failed';
      callbacks.onStep({
        stepId:    STEP_ID,
        type:      'text',
        task:      task.slice(0, 80),
        status:    'error',
        action:    'text-generation',
        agentType: 'direct',
        provider:  'openai',
        error:     msg,
      });
      callbacks.onError(msg);
    }
  })();

  return () => ac.abort();
}
