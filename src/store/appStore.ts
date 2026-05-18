import { create }                             from 'zustand';
import { persist, createJSONStorage }         from 'zustand/middleware';
import type { AgentRunResult, PlanStep, StepResult, ReActStep } from '../lib/api';
import { dbg } from './debugStore';

// ── Execution status lifecycle ────────────────────────────────────────────────
//
//  idle → planning → running → done
//                           ↘ error
//                           ↘ partial  (success but some steps failed)
//
// streaming: reserved for future SSE / real-time step-by-step updates

export type SessionStatus = 'idle' | 'planning' | 'running' | 'streaming' | 'done' | 'error' | 'partial';
export type RunMode        = 'react' | 'multi' | 'orchestrate' | 'image';
export type Theme          = 'dark' | 'light' | 'system';
export type Page = 'dashboard' | 'workspace' | 'workflows' | 'history' | 'traces' | 'memory' | 'agents' | 'observability' | 'billing' | 'settings';

// ── Unified step format ───────────────────────────────────────────────────────
// Normalizes the three different backend step shapes:
//   - ReActStep    (react mode):          thought / action / actionInput / observation
//   - StepResult   (multi/orchestrate):   task / content / provider / status
//
// ExecutionTimeline only works with this type — never with the raw API types.

export interface NormalizedStep {
  stepId:       string;
  type:         'text' | 'image';
  task:         string;        // what this step did / what action was taken
  content?:     string;        // text output
  provider?:    string;        // which AI provider ran this
  status:       'pending' | 'running' | 'done' | 'failed' | 'error';
  durationMs?:  number;
  error?:       string;
  // React-specific
  thought?:     string;
  action?:      string;
  actionInput?: string;
  observation?: string;
  // Agent metadata
  agentType?:   string;
  tool?:        string;
  reasoning?:   string;
  tokens?:      number;
  // Legacy alias — use actionInput or task instead
  input?:       string;
}

export interface ExecutionSession {
  id:             string;
  task:           string;
  mode:           RunMode;
  status:         SessionStatus;
  plan?:          PlanStep[];
  steps:          NormalizedStep[];
  result?:        AgentRunResult;
  startedAt:      number;
  durationMs?:    number;
  error?:         string;
  retryCount?:    number;
  stoppedBy?:     string;
  workflowLabel?: string;   // domain pipeline label (e.g. "Content Operations")
}


// ── Synchronous session pre-seed ─────────────────────────────────────────────
// Zustand's createJSONStorage wraps localStorage in Promises even though
// localStorage is synchronous.  The resulting one-tick delay means the store
// initialises with currentSession:null, React renders the empty state, then
// hydration fires and the session view fades in — a visible "re-render flash".
//
// Seeding currentSession directly into the initial state bypasses this: the
// very first render already has the correct session, so AnimatePresence never
// needs to transition from empty→session on page load.
//
// Zustand's async hydration still fires afterward, but since it finds the
// same session data it only creates a new object reference — React sees no DOM
// diff and the re-render is invisible.

function readSavedSession(): ExecutionSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('nexus-workspace-v2');
    if (!raw) return null;
    // Zustand persist stores data as { state: {...}, version: N }
    const parsed = JSON.parse(raw) as { state?: { currentSession?: ExecutionSession } };
    const s = parsed?.state?.currentSession;
    if (!s) return null;
    if (s.status === 'done' || s.status === 'partial' || s.status === 'error') return s;
    return null;
  } catch { return null; }
}

// ── Step normalization ────────────────────────────────────────────────────────

export function normalizeReActStep(s: ReActStep): NormalizedStep {
  return {
    stepId:      `react-step-${s.step}`,
    type:        (s.action === 'image-generation' ? 'image' : 'text') as 'text' | 'image',
    task:        s.action || `Step ${s.step}`,
    content:     s.observation,
    provider:    'agent',
    status:      (s.success ? 'done' : 'failed') as NormalizedStep['status'],
    durationMs:  s.durationMs,
    thought:     s.thought,
    action:      s.action,
    actionInput: s.actionInput,
    observation: s.observation,
    agentType:   'react',
  };
}

export function normalizeStepResult(s: StepResult): NormalizedStep {
  return {
    stepId:     s.stepId,
    type:       s.type,
    task:       s.task,
    content:    s.content,
    provider:   s.provider,
    status:     (s.status === 'skipped' ? 'error' : s.status) as NormalizedStep['status'],
    durationMs: s.durationMs,
    error:      s.error,
    agentType:  s.agentType,
    tool:       s.tool,
    reasoning:  s.reasoning,
    tokens:     s.tokens,
  };
}

function normalizeSteps(result: AgentRunResult): NormalizedStep[] {
  if (result.steps?.length)       return result.steps.map(normalizeReActStep);
  if (result.stepResults?.length) return result.stepResults.map(normalizeStepResult);
  return [];
}

// ── App state ─────────────────────────────────────────────────────────────────

interface AppState {
  // Navigation
  currentPage:     Page;
  sidebarOpen:     boolean;
  commandOpen:     boolean;

  // Execution
  runMode:         RunMode;
  currentSession:  ExecutionSession | null;
  sessionHistory:  ExecutionSession[];
  isRunning:       boolean;
  // Ephemeral — used by Workflows page to hand off a task to Workspace without
  // re-creating the component. Never persisted to localStorage.
  pendingTask:     { task: string; mode: RunMode; workflowLabel?: string } | null;

  // UI
  isMobile:        boolean;
  mobileNavOpen:   boolean;
  theme:           Theme;

  // Navigation actions
  setPendingTask:  (task: string, mode: RunMode, workflowLabel?: string) => void;
  clearPendingTask: () => void;
  setPage:         (page: Page) => void;
  toggleSidebar:   () => void;
  setSidebarOpen:  (open: boolean) => void;
  toggleCommand:   () => void;
  setCommandOpen:  (open: boolean) => void;
  setRunMode:      (mode: RunMode) => void;
  setMobile:       (mobile: boolean) => void;
  toggleMobileNav: () => void;
  setTheme:        (theme: Theme) => void;

  // Execution lifecycle
  startSession:          (task: string, mode: RunMode, workflowLabel?: string) => string;
  markRunning:           (id: string) => void;
  updateSession:         (id: string, updates: Partial<ExecutionSession>) => void;
  completeSession:       (id: string, result: AgentRunResult) => void;
  failSession:           (id: string, error: string) => void;
  clearCurrent:          () => void;
  retrySession:          (id: string) => void;
  deleteSession:         (id: string) => void;
  // Streaming — incremental updates during SSE sessions
  setSessionPlan:        (id: string, plan: PlanStep[]) => void;
  setRunningStep:        (id: string, stepNum: number, thought: string, action: string, actionInput: string) => void;
  appendStreamStep:      (id: string, step: NormalizedStep) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentPage:    'workspace',
      sidebarOpen:    true,
      commandOpen:    false,
      runMode:        'orchestrate',
      currentSession: readSavedSession(),   // synchronous — no flash on first render
      sessionHistory: [],
      isRunning:      false,
      pendingTask:    null,
      isMobile:       typeof window !== 'undefined' && window.innerWidth < 768,
      mobileNavOpen:  false,
      theme:          'dark',

      setPendingTask:  (task, mode, workflowLabel) => set({ pendingTask: { task, mode, workflowLabel } }),
      clearPendingTask: () => set({ pendingTask: null }),
      setPage:         (page)  => set({ currentPage: page, mobileNavOpen: false }),
      toggleSidebar:   ()      => set(s => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen:  (open)  => set({ sidebarOpen: open }),
      toggleCommand:   ()      => set(s => ({ commandOpen: !s.commandOpen })),
      setCommandOpen:  (open)  => set({ commandOpen: open }),
      setRunMode:      (mode)  => set({ runMode: mode }),
      setMobile:       (m)     => set({ isMobile: m }),
      toggleMobileNav: ()      => set(s => ({ mobileNavOpen: !s.mobileNavOpen })),
      setTheme:        (theme) => set({ theme }),

      startSession: (task, mode, workflowLabel) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const session: ExecutionSession = {
          id, task, mode,
          status:        'planning',
          steps:         [],
          startedAt:     Date.now(),
          workflowLabel,
        };
        dbg('store', `startSession id=${id}`, { mode, task: task.slice(0, 60) });
        set({ currentSession: session, isRunning: true });
        return id;
      },

      markRunning: (id) => {
        const { currentSession } = get();
        if (currentSession?.id === id && currentSession.status === 'planning') {
          dbg('store', `markRunning id=${id}`);
          set({ currentSession: { ...currentSession, status: 'running' } });
        }
      },

      updateSession: (id, updates) => {
        const { currentSession } = get();
        if (currentSession?.id === id) {
          set({ currentSession: { ...currentSession, ...updates } });
        }
      },

      completeSession: (id, result) => {
        const { currentSession, sessionHistory } = get();
        if (currentSession?.id !== id) {
          dbg('error', `completeSession id mismatch: expected=${id} current=${currentSession?.id}`);
          return;
        }

        // Prefer result-normalized steps; fall back to whatever was streamed in
        // (handles timeout/abort where the agent returns an empty steps array)
        const fromResult  = normalizeSteps(result);
        const steps       = fromResult.length > 0 ? fromResult : currentSession.steps;
        // Exclude the 'finish' sentinel step from failure accounting —
        // it is an internal react-agent lifecycle marker, not a real tool step.
        const toolSteps   = steps.filter(s => s.action !== 'finish');
        const hasErrors   = toolSteps.some(s => s.status === 'failed' || s.status === 'error');
        const hasContent  = steps.length > 0 || result.finalAnswer?.trim();

        // A session is "done" if:
        //   (a) the agent succeeded AND the final answer is substantive (≥200 chars), OR
        //   (b) the agent succeeded AND no tool steps failed.
        // Only show "partial" when errors exist AND the output is thin/empty.
        // This prevents a single recoverable intermediate failure (e.g. LLM synonym
        // mismatch on an early step) from tainting an otherwise complete result.
        const hasSolidAnswer = (result.finalAnswer?.trim().length ?? 0) >= 200;
        const status: SessionStatus = result.success
          ? (hasErrors && !hasSolidAnswer ? 'partial' : 'done')
          : hasContent
            ? 'partial'
            : 'error';

        const completed: ExecutionSession = {
          ...currentSession,
          status,
          result,
          steps,
          plan:       result.plan,
          durationMs: result.durationMs,
          stoppedBy:  result.stoppedBy,
          error:      status === 'error' ? (result as { error?: string }).error : undefined,
        };

        dbg('store', `completeSession id=${id}`, {
          status, steps: steps.length, stoppedBy: result.stoppedBy,
        });
        set({
          currentSession: completed,
          sessionHistory: [completed, ...sessionHistory].slice(0, 30),
          isRunning:      false,
        });
      },

      failSession: (id, error) => {
        const { currentSession, sessionHistory } = get();
        if (currentSession?.id !== id) {
          dbg('error', `failSession id mismatch: expected=${id} current=${currentSession?.id}`);
          return;
        }
        // Defense-in-depth: never overwrite a successfully completed session.
        // Guards against the Cloudflare teardown race where connection-cleanup
        // errors fire onError after onDone has already marked the session done.
        if (currentSession.status === 'done' || currentSession.status === 'partial') {
          dbg('store', `ignoring failSession for completed session`, { id, status: currentSession.status });
          return;
        }

        const failed: ExecutionSession = {
          ...currentSession,
          status:    'error',
          error,
          durationMs: Date.now() - currentSession.startedAt,
        };

        dbg('store', `failSession id=${id}`, { error: error.slice(0, 80) });
        set({
          currentSession: failed,
          sessionHistory: [failed, ...sessionHistory].slice(0, 30),
          isRunning:      false,
        });
      },

      setSessionPlan: (id, plan) => {
        const { currentSession } = get();
        if (currentSession?.id !== id) return;
        // Never overwrite a completed session — late plan events can arrive after done
        if (currentSession.status === 'done' || currentSession.status === 'partial' || currentSession.status === 'error') return;
        const updated = { ...currentSession, plan, status: 'running' as SessionStatus };
        set({ currentSession: updated });
      },

      setRunningStep: (id, stepNum, thought, action, actionInput) => {
        const { currentSession } = get();
        if (currentSession?.id !== id) return;
        // Don't inject running placeholders into a completed session
        if (currentSession.status === 'done' || currentSession.status === 'partial' || currentSession.status === 'error') return;
        const placeholder: NormalizedStep = {
          stepId:      `react-step-${stepNum}`,
          type:        action === 'image-generation' ? 'image' : 'text',
          task:        action || `Step ${stepNum}`,
          status:      'running',
          thought,
          action,
          actionInput,
          agentType:   'react',
        };
        const existing = currentSession.steps.findIndex(s => s.stepId === placeholder.stepId);
        const steps = existing >= 0
          ? currentSession.steps.map((s, i) => i === existing ? placeholder : s)
          : [...currentSession.steps, placeholder];
        const updated = { ...currentSession, steps, status: 'streaming' as SessionStatus };
        set({ currentSession: updated });
      },

      appendStreamStep: (id, step) => {
        const { currentSession } = get();
        if (currentSession?.id !== id) return;
        // Don't downgrade a completed session's status back to 'streaming'
        if (currentSession.status === 'done' || currentSession.status === 'partial' || currentSession.status === 'error') return;
        // Replace existing step by stepId (running placeholder → completed), or append
        const existing = currentSession.steps.findIndex(s => s.stepId === step.stepId);
        const steps = existing >= 0
          ? currentSession.steps.map((s, i) => i === existing ? step : s)
          : [...currentSession.steps, step];
        const updated = {
          ...currentSession,
          status: 'streaming' as SessionStatus,
          steps,
        };
        set({ currentSession: updated });
      },

      clearCurrent: () => {
        set({ currentSession: null });
      },

      deleteSession: (id) => {
        const { currentSession } = get();
        set(s => ({
          sessionHistory: s.sessionHistory.filter(sess => sess.id !== id),
          currentSession: currentSession?.id === id ? null : s.currentSession,
        }));
      },

      retrySession: (id) => {
        const { currentSession } = get();
        if (currentSession?.id !== id) return;
        // Re-prime the session for a retry attempt
        set({
          currentSession: {
            ...currentSession,
            status:      'planning',
            steps:       [],
            error:       undefined,
            result:      undefined,
            durationMs:  undefined,
            retryCount:  (currentSession.retryCount ?? 0) + 1,
            startedAt:   Date.now(),
          },
          isRunning: true,
        });
      },
    }),

    {
      name:    'nexus-workspace-v2',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state, error) => {
        if (error) { dbg('error', `persist rehydrate failed: ${error}`); return; }
        dbg('store', 'persist rehydrated', {
          session: state?.currentSession?.id?.slice(0, 10) ?? 'none',
          status:  state?.currentSession?.status ?? 'none',
          history: state?.sessionHistory?.length ?? 0,
        });
      },
      // Persist runMode, sessionHistory, and the current session if it has
      // completed (done/partial/error) so output survives a page refresh.
      // In-progress sessions are intentionally excluded: they can't be resumed
      // and would show stale data. Zustand's shallow merge means excluded keys
      // fall back to initialState (currentSession: null) on reload.
      partialize: (state) => {
        // pendingTask is intentionally excluded — it's ephemeral and must not survive a reload.
        const base = {
          runMode:        state.runMode,
          theme:          state.theme,
          sessionHistory: state.sessionHistory
            .filter(s => s.status !== 'planning' && s.status !== 'running')
            .slice(0, 20),
        };
        const s = state.currentSession;
        if (s && (s.status === 'done' || s.status === 'partial' || s.status === 'error')) {
          return { ...base, currentSession: s };
        }
        return base;
      },
    }
  )
);
