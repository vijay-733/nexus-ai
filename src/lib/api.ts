// Typed API client.
// In dev: BASE='' so all calls go through the Vite proxy to :3002.
// In production: VITE_API_URL points to the Render backend URL.
//
// Reliability features:
//   - Every call has an explicit AbortSignal timeout (never hangs forever)
//   - 502/503 transient errors auto-retry once after 800ms
//   - 401 clears stored credentials (forces re-login)
//   - 422 step-level error extraction for clear orchestrator error messages

export const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

// Timeouts per category — generous for agent calls, strict for everything else
const TIMEOUT = {
  agent:   135_000,   // 135s — above server's 120s hard limit + some slack
  default:  30_000,   // 30s for all other calls
} as const;

async function requestOnce<T>(
  path:    string,
  options?: RequestInit,
  signal?:  AbortSignal,
): Promise<T> {
  const token     = localStorage.getItem('nexus_token');
  const geminiKey = localStorage.getItem('nexus_gemini_key');
  const openaiKey = localStorage.getItem('nexus_openai_key');
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    signal,
    headers: {
      'Content-Type':           'application/json',
      'bypass-tunnel-reminder': 'true',
      ...(token     ? { Authorization:  `Bearer ${token}` } : {}),
      ...(geminiKey ? { 'x-gemini-key': geminiKey }        : {}),
      ...(openaiKey ? { 'x-openai-key': openaiKey }        : {}),
      ...(options?.headers ?? {}),
    },
  });

  if (res.status === 401) {
    // Token expired or revoked — clear BOTH the raw key AND the Zustand persist
    // store ('nexus-auth').  Removing only 'nexus_token' leaves isAuthenticated:true
    // in the persisted store, so on reload the app looks authenticated, every
    // request gets 401 again, and the page reloads in an infinite loop.
    localStorage.removeItem('nexus_token');
    localStorage.removeItem('nexus_user');
    localStorage.removeItem('nexus-auth');
    window.location.reload();
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    if (res.status === 502 || res.status === 503) {
      throw new Error('__TRANSIENT__');   // caller retries these
    }
    if (res.status === 408) {
      throw new Error('Request timed out. The server may be overloaded.');
    }

    const body = await res.json().catch(() => ({ error: res.statusText }));
    const b = body as {
      error?: string;
      stepResults?: Array<{ error?: string }>;
      steps?:       Array<{ success?: boolean }>;
    };

    // 422 — orchestrator/multi/react completed but all steps failed
    if (res.status === 422) {
      if (!b.error && b.stepResults?.length) {
        const stepErr = b.stepResults.find(s => s.error)?.error;
        throw new Error(
          stepErr ??
          'All AI steps failed. Add OPENAI_API_KEY or GEMINI_API_KEY to .env for reliable responses.',
        );
      }
    }

    throw new Error(b.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// Wraps requestOnce with one automatic retry on transient 502/503 errors
async function request<T>(
  path:       string,
  options?:   RequestInit,
  timeoutMs?: number,
): Promise<T> {
  const ms     = timeoutMs ?? TIMEOUT.default;
  const signal = AbortSignal.timeout(ms);

  try {
    return await requestOnce<T>(path, options, signal);
  } catch (err) {
    if (err instanceof Error && err.message === '__TRANSIENT__') {
      // One retry after short back-off
      await new Promise(r => setTimeout(r, 800));
      const retrySignal = AbortSignal.timeout(ms);
      try {
        return await requestOnce<T>(path, options, retrySignal);
      } catch (retryErr) {
        if (retryErr instanceof Error && retryErr.message === '__TRANSIENT__') {
          throw new Error('Backend unreachable. Make sure the server is running.');
        }
        throw retryErr;
      }
    }
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error('Request timed out. The server may be overloaded or the connection is slow.');
    }
    throw err;
  }
}

// ── Auth ────────────────────────────────────────────────────────────────────

export interface AuthResponse {
  token: string;
  user:  { id: string; email: string; plan: string; credits: number };
}

export const authApi = {
  register: (email: string, password: string, name: string) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ user: AuthResponse['user'] }>('/auth/me'),
};

// ── Agent ───────────────────────────────────────────────────────────────────

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

export interface AgentRunResult {
  success:          boolean;
  finalAnswer:      string;
  // react mode
  steps?:           ReActStep[];
  // multi / orchestrate mode
  stepResults?:     StepResult[];
  plan?:            PlanStep[];
  sessionId?:       string;
  taskId?:          string;
  supervisorScore?: number;
  totalSteps?:      number;
  completedSteps?:  number;
  durationMs:       number;
  stoppedBy?:       string;
  tokens?:          number;
  cost?:            number;
  usage:            { creditsUsed: number; creditsRemaining: number; plan: string };
}

export interface StepResult {
  stepId:      string;
  type:        'text' | 'image';
  task:        string;
  content:     string;
  provider:    string;
  status:      'done' | 'failed' | 'skipped' | 'running' | 'error';
  durationMs:  number;
  error?:      string;
  // enriched fields (populated where available)
  agentType?:  string;
  tool?:       string;
  input?:      string;
  output?:     unknown;
  reasoning?:  string;
  tokens?:     number;
}

export interface PlanStep {
  id:           string;
  type:         'text' | 'image';
  task:         string;
  description?: string;
  dependsOn:    string[];
  status:       'pending' | 'running' | 'done' | 'failed';
}

export interface AgentDirectResponse {
  success:    boolean;
  requestId:  string;
  tool:       string;
  result?:    { type: 'image' | 'text'; content: string; provider: string; meta?: unknown };
  error?:     string;
  usage:      { creditsUsed: number; creditsRemaining: number; plan: string };
  memoryUsed: number;
  durationMs: number;
}

export const agentApi = {
  run: (task: 'image' | 'text' | 'auto', prompt: string, options?: Record<string, unknown>) =>
    request<AgentDirectResponse>('/agent/run', {
      method: 'POST',
      body:   JSON.stringify({ task, prompt, options }),
    }, TIMEOUT.agent),

  react: (task: string, maxSteps = 5) =>
    request<AgentRunResult>('/agent/react', {
      method: 'POST',
      body:   JSON.stringify({ task, maxSteps }),
    }, TIMEOUT.agent),

  multi: (task: string, options?: Record<string, unknown>) =>
    request<AgentRunResult>('/agent/multi', {
      method: 'POST',
      body:   JSON.stringify({ task, options }),
    }, TIMEOUT.agent),

  orchestrate: (task: string, options?: Record<string, unknown>) =>
    request<AgentRunResult>('/agent/orchestrate', {
      method: 'POST',
      body:   JSON.stringify({ task, options }),
    }, TIMEOUT.agent),

  getMemory: () =>
    request<{ count: number; entries: unknown[] }>('/agent/memory'),

  clearMemory: () =>
    request<{ cleared: boolean }>('/agent/memory', { method: 'DELETE' }),

  getSession: (id: string) =>
    request<unknown>(`/agent/session/${id}`),
};

// ── Usage ───────────────────────────────────────────────────────────────────

export interface UsageStats {
  user: { id: string; email: string; plan: string; credits: number };
  usage: {
    total:       number;
    success:     number;
    failed:      number;
    blocked:     number;
    creditsUsed: number;
    byTool:      Record<string, number>;
    recent:      Array<{
      id: string; tool: string; provider: string; status: string;
      creditsUsed: number; durationMs: number; prompt: string; timestamp: number;
    }>;
  };
}

export const usageApi = {
  get: () => request<UsageStats>('/usage'),
};

// ── Tasks ───────────────────────────────────────────────────────────────────

export interface Task {
  id:          string;
  status:      'pending' | 'running' | 'completed' | 'failed';
  type:        string;
  input:       unknown;
  output?:     unknown;
  plan?:       PlanStep[];
  stepResults?: StepResult[];
  error?:      string;
  createdAt:   number;
  completedAt?: number;
  durationMs?:  number;
}

export const tasksApi = {
  create: (task: string, options?: Record<string, unknown>) =>
    request<Task>('/tasks', {
      method: 'POST',
      body:   JSON.stringify({ task, ...options }),
    }, TIMEOUT.agent),

  get:  (id: string) => request<Task>(`/tasks/${id}`),
  list: ()           => request<{ tasks: Task[] }>('/tasks'),
};

// ── Memory ──────────────────────────────────────────────────────────────────

export interface MemoryRecord {
  id:        string;
  namespace: string;
  key:       string;
  value:     unknown;
  tags:      string[];
  createdAt: number;
  updatedAt: number;
}

export const memoryApi = {
  list:   (namespace?: string) =>
    request<{ records: MemoryRecord[] }>(`/memory${namespace ? `?namespace=${namespace}` : ''}`),
  get:    (namespace: string, key: string) =>
    request<MemoryRecord>(`/memory/${namespace}/${key}`),
  set:    (namespace: string, key: string, value: unknown, tags?: string[]) =>
    request<MemoryRecord>('/memory', { method: 'POST', body: JSON.stringify({ namespace, key, value, tags }) }),
  delete: (namespace: string, key: string) =>
    request<{ deleted: boolean }>(`/memory/${namespace}/${key}`, { method: 'DELETE' }),
};

// ── Observability ────────────────────────────────────────────────────────────

export interface MetricsReport {
  uptime:     number;
  agents:     { started: number; completed: number; failed: number };
  tasks:      { created: number; completed: number; failed: number };
  models:     Record<string, { provider: string; requests: number; failures: number; totalTokens: number; totalLatencyMs: number }>;
  tools:      Record<string, { name: string; calls: number; successes: number; failures: number; totalLatencyMs: number }>;
  memory:     { reads: number; writes: number; deletes: number };
  governance: { checks: number; denials: number };
  events:     { total: number };
}

export interface TraceLog {
  id:        string;
  level:     'info' | 'warn' | 'error' | 'debug';
  source:    string;
  message:   string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export const observabilityApi = {
  metrics:   ()             => request<MetricsReport>('/metrics/json'),
  dashboard: ()             => request<unknown>('/observability/dashboard'),
  logs:      (limit = 50)   => request<{ logs: TraceLog[] }>(`/observability/logs?limit=${limit}`),
  traces:    ()             => request<unknown>('/observability/traces'),
};

// ── Health ───────────────────────────────────────────────────────────────────

export interface HealthReport {
  status:  'healthy' | 'degraded' | 'unhealthy';
  checks:  Record<string, { status: string; value?: number; threshold?: number }>;
  timestamp: number;
}

export const healthApi = {
  get:  () => request<HealthReport>('/health'),
  live: () => request<{ ok: boolean }>('/health/live'),
};

// ── Queue ────────────────────────────────────────────────────────────────────

export const queueApi = {
  jobs:    () => request<{ count: number; jobs: unknown[] }>('/queue/jobs'),
  workers: () => request<unknown>('/queue/workers'),
  health:  () => request<{ ok: boolean; queueDepth: number; dlqDepth: number }>('/queue/health'),
  dlq:     () => request<{ count: number; items: unknown[] }>('/queue/dlq'),
};

// ── Billing ──────────────────────────────────────────────────────────────────

export interface BillingAccount {
  userId:       string;
  plan:         string;
  credits:      number;
  creditsUsed:  number;
  resetAt:      number;
  transactions: Array<{ id: string; amount: number; action: string; timestamp: number }>;
}

export const billingApi = {
  account: ()           => request<BillingAccount>('/billing/account'),
  plans:   ()           => request<unknown>('/billing/plans'),
  upgrade: (plan: string) =>
    request<unknown>('/billing/upgrade', { method: 'POST', body: JSON.stringify({ plan }) }),
};

// ── Status ───────────────────────────────────────────────────────────────────

export const statusApi = {
  get: () => request<{ ok: boolean; imageProvider: string; hasOpenAI: boolean; freeMode: boolean }>('/api/status'),
};
