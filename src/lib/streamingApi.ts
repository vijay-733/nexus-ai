// Fetch-based SSE client for the /stream/* endpoints.
//
// Uses fetch() instead of native EventSource because:
//   - EventSource only supports GET (agents need POST with a body)
//   - EventSource can't send Authorization headers
//
// Known failure modes handled here:
//   - 401: clears BOTH nexus_token AND the Zustand persist key nexus-auth to
//          prevent an infinite reload loop (see api.ts for the same fix)
//   - Orphan stream: if the stream closes without a 'done'/'error' event,
//          onError is called so the session never stays stuck in 'streaming'
//   - TextDecoder flush: decoder.decode() is called with no args before break
//          to flush any bytes the decoder was holding internally; without this
//          the final SSE chunk (the 'done' event) can be silently dropped

import type { AgentRunResult, PlanStep, ReActStep, StepResult } from './api.js';
import { BASE } from './api.js';
import { dbg } from '../store/debugStore.js';

// ── Event types from server ───────────────────────────────────────────────────

export type StepStartPayload = {
  stepNum:     number;
  thought:     string;
  action:      string;
  actionInput: string;
};

type PlanEvent      = { type: 'plan';       plan:   PlanStep[] };
type StepStartEvent = { type: 'step_start'; } & StepStartPayload;
type StepEvent      = { type: 'step';       step:   StepResult | ReActStep };
type DoneEvent      = { type: 'done';       result: AgentRunResult };
type ErrorEvent     = { type: 'error';      error:  string };
type HeartbeatEvent = { type: 'heartbeat';  ts:     number };
type StreamEvent = PlanEvent | StepStartEvent | StepEvent | DoneEvent | ErrorEvent | HeartbeatEvent;

export interface StreamCallbacks {
  onPlan?:      (plan:    PlanStep[])              => void;
  onStepStart?: (payload: StepStartPayload)        => void;
  onStep?:      (step:    StepResult | ReActStep)  => void;
  onDone?:      (result:  AgentRunResult)          => void;
  onError?:     (error:   string)                  => void;
}

export type StreamMode = 'react' | 'multi' | 'orchestrate';

// ── SSE line parser ───────────────────────────────────────────────────────────

function parseSseChunk(raw: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const block of raw.split('\n\n')) {
    for (const line of block.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const json = t.slice('data:'.length).trim();
      if (!json) continue;
      try {
        events.push(JSON.parse(json) as StreamEvent);
      } catch {
        dbg('stream', 'malformed SSE JSON', json.slice(0, 80));
      }
    }
  }
  return events;
}

function dispatchEvent(event: StreamEvent, callbacks: StreamCallbacks): boolean {
  switch (event.type) {
    case 'plan':
      dbg('stream', 'plan', { steps: (event.plan ?? []).length });
      callbacks.onPlan?.(event.plan);
      break;
    case 'step_start':
      dbg('stream', `step_start #${event.stepNum}`, { action: event.action });
      callbacks.onStepStart?.({
        stepNum:     event.stepNum,
        thought:     event.thought,
        action:      event.action,
        actionInput: event.actionInput,
      });
      break;
    case 'step':
      dbg('stream', 'step', {
        action: ('action' in event.step) ? event.step.action : event.step.status,
      });
      callbacks.onStep?.(event.step);
      break;
    case 'done':
      dbg('stream', 'done', {
        success: event.result.success,
        stoppedBy: event.result.stoppedBy,
        answerLen: event.result.finalAnswer?.length ?? 0,
      });
      callbacks.onDone?.(event.result);
      return true;
    case 'error':
      dbg('error', `server error: ${event.error}`);
      callbacks.onError?.(event.error);
      return true;
    case 'heartbeat':
      dbg('stream', `heartbeat ts=${event.ts}`);
      break;
  }
  return false;
}

// ── Main streaming function ───────────────────────────────────────────────────
// Returns a cancel function.  When cancel() is called the fetch is aborted.
// Detects stream-end-without-done (silent kill) and calls onError so the
// session never stays stuck in 'streaming' state.

export function streamAgent(
  mode:      StreamMode,
  body:      { task: string; maxSteps?: number; options?: Record<string, unknown> },
  callbacks: StreamCallbacks,
  externalSignal?: AbortSignal,
): () => void {
  const ac = new AbortController();
  if (externalSignal) {
    externalSignal.addEventListener('abort', () => ac.abort(), { once: true });
  }

  const token     = localStorage.getItem('nexus_token');
  const geminiKey = localStorage.getItem('nexus_gemini_key');
  const openaiKey = localStorage.getItem('nexus_openai_key');
  dbg('stream', `START mode=${mode}`, { task: (body.task ?? '').slice(0, 60) });

  (async () => {
    let res: Response;
    try {
      res = await fetch(`${BASE}/stream/${mode}`, {
        method: 'POST',
        signal: ac.signal,
        headers: {
          'Content-Type':           'application/json',
          'bypass-tunnel-reminder': 'true',
          ...(token     ? { Authorization:  `Bearer ${token}` } : {}),
          ...(geminiKey ? { 'x-gemini-key': geminiKey }        : {}),
          ...(openaiKey ? { 'x-openai-key': openaiKey }        : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (ac.signal.aborted) { dbg('stream', 'aborted before connect'); return; }
      const msg = err instanceof Error ? err.message : 'Connection failed';
      dbg('error', `CONNECT ERROR: ${msg}`);
      callbacks.onError?.(msg);
      return;
    }

    dbg('stream', `HTTP ${res.status} ${res.statusText}`);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg = `HTTP ${res.status}`;
      try { msg = (JSON.parse(text) as { error?: string }).error ?? msg; } catch { /* noop */ }

      if (res.status === 401) {
        // Clear BOTH raw key AND Zustand persist store to prevent reload loop.
        // If only nexus_token is removed, nexus-auth still has isAuthenticated:true,
        // so the next request also gets 401 and the page reloads indefinitely.
        localStorage.removeItem('nexus_token');
        localStorage.removeItem('nexus_user');
        localStorage.removeItem('nexus-auth');
        dbg('error', '401 — clearing auth and reloading');
        window.location.reload();
        return;
      }

      dbg('error', `HTTP ERROR: ${msg}`);
      callbacks.onError?.(msg);
      return;
    }

    if (!res.body) {
      callbacks.onError?.('No response body — server may not support streaming');
      return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';
    let   done    = false;   // true once 'done' or 'error' event received
    let   chunks  = 0;

    try {
      while (true) {
        const { done: streamDone, value } = await reader.read();

        if (streamDone) {
          // CRITICAL: flush the decoder's internal byte buffer before breaking.
          // Without this call the final bytes (often the 'done' SSE event) can
          // sit inside the decoder's state and never reach parseSseChunk.
          buffer += decoder.decode();   // flush with no args
          break;
        }

        chunks++;
        buffer += decoder.decode(value, { stream: true });

        const boundary = buffer.lastIndexOf('\n\n');
        if (boundary === -1) continue;

        const complete = buffer.slice(0, boundary + 2);
        buffer         = buffer.slice(boundary + 2);

        for (const event of parseSseChunk(complete)) {
          const terminal = dispatchEvent(event, callbacks);
          if (terminal) {
            done = true;
            break;  // stop processing remaining events in this chunk
          }
        }

        // Exit the read loop immediately once a terminal event is received.
        // This prevents the connection-teardown error (proxy/tunnel cleanup
        // after the final frame) from reaching the catch block and calling
        // onError after the task has already completed successfully.
        if (done) break;
      }

      // Flush any remaining partial SSE block (only reached if done is still false)
      if (!done && buffer.trim()) {
        dbg('stream', 'flushing tail buffer', { len: buffer.length });
        for (const event of parseSseChunk(buffer)) {
          const terminal = dispatchEvent(event, callbacks);
          if (terminal) done = true;
        }
      }

      dbg('stream', `END chunks=${chunks} done=${done} aborted=${ac.signal.aborted}`);

      // Stream closed without a terminal event → silent kill (proxy timeout, server crash)
      if (!done && !ac.signal.aborted) {
        const msg = chunks === 0
          ? 'Server did not stream any data — check server is running and JWT_SECRET is set'
          : 'Stream closed unexpectedly before completion — the task may have timed out';
        dbg('error', `ORPHAN STREAM: ${msg}`, { chunks });
        callbacks.onError?.(msg);
      }
    } catch (err) {
      if (ac.signal.aborted) { dbg('stream', 'read aborted (expected on cancel)'); return; }
      // Ignore read errors that arrive after the task already completed.
      // This is common with Cloudflare/nginx tunnels: they send a connection-
      // teardown error a few seconds after the final HTTP/2 DATA frame, even
      // though the client has already received and processed the 'done' event.
      if (done) { dbg('stream', 'ignoring post-done read error (tunnel cleanup)'); return; }
      const msg = err instanceof Error ? err.message : 'Stream read error';
      dbg('error', `READ ERROR: ${msg}`);
      callbacks.onError?.(msg);
    } finally {
      try { reader.releaseLock(); } catch { /* already released if we broke early */ }
    }
  })();

  return () => { dbg('stream', 'CANCEL called'); ac.abort(); };
}
