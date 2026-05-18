// Calls Gemini API directly from the browser — no backend needed.
// Used when nexus_gemini_key is set in localStorage.
// The SSE stream from Gemini is parsed chunk-by-chunk and fed into
// the same NormalizedStep / AgentRunResult types the rest of the app uses.

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

export function getGeminiKey(): string | null {
  return localStorage.getItem('nexus_gemini_key')?.trim() || null;
}

export function streamGeminiDirect(
  task: string,
  callbacks: DirectStreamCallbacks,
): () => void {
  const key = getGeminiKey();
  if (!key) {
    callbacks.onError(
      'No Gemini API key found. Go to Settings → API Keys and paste your key, then Save Changes.',
    );
    return () => {};
  }

  const ac        = new AbortController();
  const startedAt = Date.now();
  const STEP_ID   = 'direct-gemini-1';

  // Immediately surface a "running" placeholder so the timeline shows activity
  callbacks.onStep({
    stepId:    STEP_ID,
    type:      'text',
    task:      task.slice(0, 80),
    status:    'running',
    thought:   'Sending request to Gemini 2.5 Flash…',
    action:    'text-generation',
    agentType: 'direct',
    provider:  'gemini',
  });

  (async () => {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${key}&alt=sse`,
        {
          method:  'POST',
          signal:  ac.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents:           [{ parts: [{ text: task }] }],
            generationConfig:   { maxOutputTokens: 8192, temperature: 0.7 },
          }),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string; status?: string } };
        const msg  = body.error?.message ?? `Gemini API returned ${res.status}`;
        throw new Error(
          res.status === 400 ? `Invalid request: ${msg}` :
          res.status === 401 || res.status === 403
            ? `API key rejected. Check your Gemini key in Settings → API Keys. (${msg})`
            : msg,
        );
      }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText  = '';
      let buf       = '';

      outer: while (true) {
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
              candidates?: Array<{
                content?:      { parts?: Array<{ text?: string }> };
                finishReason?: string;
              }>;
              error?: { message: string };
            };

            if (chunk.error) throw new Error(chunk.error.message);

            const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            if (text) {
              fullText += text;
              // Push live content into the step while still running
              callbacks.onStep({
                stepId:    STEP_ID,
                type:      'text',
                task:      task.slice(0, 80),
                content:   fullText,
                status:    'running',
                action:    'text-generation',
                agentType: 'direct',
                provider:  'gemini',
              });
            }

            const finish = chunk.candidates?.[0]?.finishReason;
            if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') {
              throw new Error(`Gemini stopped: ${finish}`);
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue; // malformed chunk — skip
            throw parseErr;
          }
        }
      }

      // Flush decoder
      buf += decoder.decode();
      if (buf.trim()) {
        // process any remaining buffered data
      }

      if (!fullText) throw new Error('Gemini returned an empty response. Try again.');

      const durationMs = Date.now() - startedAt;

      // Mark step done
      callbacks.onStep({
        stepId:    STEP_ID,
        type:      'text',
        task:      task.slice(0, 80),
        content:   fullText,
        status:    'done',
        action:    'text-generation',
        agentType: 'direct',
        provider:  'gemini',
        durationMs,
      });

      callbacks.onDone({
        success:     true,
        finalAnswer: fullText,
        durationMs,
        usage: { creditsUsed: 0, creditsRemaining: 9999, plan: 'gemini-direct' },
      });

    } catch (err) {
      if (ac.signal.aborted) return;
      const msg = err instanceof Error ? err.message : 'Gemini request failed';
      callbacks.onStep({
        stepId:    STEP_ID,
        type:      'text',
        task:      task.slice(0, 80),
        status:    'error',
        action:    'text-generation',
        agentType: 'direct',
        provider:  'gemini',
        error:     msg,
      });
      callbacks.onError(msg);
    }
  })();

  return () => ac.abort();
}
