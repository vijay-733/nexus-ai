import { create } from 'zustand';

export type DebugCategory = 'stream' | 'store' | 'render' | 'lifecycle' | 'error' | 'nav';

export interface DebugEvent {
  id:       number;
  ts:       number;
  elapsed:  number;   // ms since previous event
  category: DebugCategory;
  event:    string;
  data?:    string;   // JSON-serialised extras, kept short
}

const MAX_EVENTS = 150;
let   SEQ        = 0;
let   lastTs     = Date.now();

interface DebugState {
  events:    DebugEvent[];
  visible:   boolean;
  sessionId: string | null;
  log:  (category: DebugCategory, event: string, data?: unknown) => void;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  clear: () => void;
  setSessionId: (id: string | null) => void;
}

export const useDebugStore = create<DebugState>()((set, get) => ({
  events:    [],
  visible:   false,
  sessionId: null,

  log: (category, event, data) => {
    const now     = Date.now();
    const elapsed = now - lastTs;
    lastTs        = now;
    const entry: DebugEvent = {
      id: ++SEQ, ts: now, elapsed, category, event,
      data: data !== undefined
        ? JSON.stringify(data, null, 0).slice(0, 120)
        : undefined,
    };
    set(s => ({
      events: [entry, ...s.events].slice(0, MAX_EVENTS),
    }));
  },

  show:  () => set({ visible: true }),
  hide:  () => set({ visible: false }),
  toggle: () => set(s => ({ visible: !s.visible })),
  clear: () => set({ events: [] }),
  setSessionId: (id) => set({ sessionId: id }),
}));

export const dbg = (category: DebugCategory, event: string, data?: unknown) =>
  useDebugStore.getState().log(category, event, data);
