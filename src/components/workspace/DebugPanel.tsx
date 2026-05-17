import { useEffect } from 'react';
import { X, Bug, Trash2 } from 'lucide-react';
import { useDebugStore, type DebugEvent } from '../../store/debugStore';
import { useAppStore } from '../../store/appStore';

const CAT_COLOR: Record<string, string> = {
  stream:    'text-[var(--color-nexus-blue)]',
  store:     'text-[var(--color-nexus-accent)]',
  render:    'text-[var(--color-nexus-purple)]',
  lifecycle: 'text-[var(--color-nexus-amber)]',
  error:     'text-[var(--color-nexus-red)]',
  nav:       'text-[var(--color-text-muted)]',
};

function EventRow({ e }: { e: DebugEvent }) {
  const time = new Date(e.ts).toISOString().slice(11, 23);
  return (
    <div className="grid grid-cols-[80px_60px_120px_1fr] gap-1 text-[10px] font-mono py-0.5 border-b border-[var(--color-nexus-border)] last:border-0 leading-tight">
      <span className="text-[var(--color-text-muted)]">{time}</span>
      <span className="text-[var(--color-text-muted)]">+{e.elapsed}ms</span>
      <span className={CAT_COLOR[e.category] ?? 'text-[var(--color-text-muted)]'}>{e.category}</span>
      <span className="text-[var(--color-text-primary)] truncate" title={e.data ?? ''}>
        {e.event}
        {e.data && <span className="text-[var(--color-text-muted)] ml-1">{e.data}</span>}
      </span>
    </div>
  );
}

export function DebugPanel() {
  const { visible, events, toggle, hide, clear } = useDebugStore();
  const session  = useAppStore(s => s.currentSession);
  const running  = useAppStore(s => s.isRunning);

  // Ctrl+Shift+D toggles the panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle]);

  // Floating toggle button (always visible)
  const toggleBtn = (
    <button
      onClick={toggle}
      title="Debug panel (Ctrl+Shift+D)"
      className="fixed bottom-20 right-4 z-50 w-8 h-8 rounded-full bg-[var(--color-nexus-elevated)] border border-[var(--color-nexus-border)] flex items-center justify-center hover:border-[var(--color-nexus-accent)] transition-colors opacity-40 hover:opacity-100"
    >
      <Bug size={14} className="text-[var(--color-text-muted)]" />
    </button>
  );

  if (!visible) return toggleBtn;

  return (
    <>
      {toggleBtn}
      <div className="fixed bottom-0 right-0 z-50 w-[620px] max-h-[55vh] flex flex-col bg-[var(--color-nexus-surface)] border-l border-t border-[var(--color-nexus-border)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-nexus-border)] shrink-0">
          <Bug size={13} className="text-[var(--color-nexus-accent)]" />
          <span className="text-xs font-semibold text-[var(--color-text-primary)]">Debug Panel</span>
          <span className="text-[10px] text-[var(--color-text-muted)] ml-1">Ctrl+Shift+D</span>

          {/* Session summary */}
          <div className="ml-auto flex items-center gap-3 text-[10px] font-mono text-[var(--color-text-muted)]">
            {session ? (
              <>
                <span className="text-[var(--color-nexus-accent)]">{session.id.slice(0, 10)}</span>
                <span className={
                  session.status === 'streaming' ? 'text-[var(--color-nexus-blue)]' :
                  session.status === 'done'      ? 'text-[var(--color-nexus-green)]' :
                  session.status === 'error'     ? 'text-[var(--color-nexus-red)]' :
                  'text-[var(--color-nexus-amber)]'
                }>{session.status}</span>
                <span>{session.steps.length} steps</span>
                <span className={running ? 'text-[var(--color-nexus-amber)]' : 'text-[var(--color-text-muted)]'}>
                  {running ? '⚡ running' : '◉ idle'}
                </span>
              </>
            ) : (
              <span>no session</span>
            )}
          </div>

          <button onClick={clear} title="Clear log" className="p-1 hover:text-[var(--color-nexus-red)] transition-colors">
            <Trash2 size={12} className="text-[var(--color-text-muted)]" />
          </button>
          <button onClick={hide} className="p-1 hover:text-[var(--color-nexus-red)] transition-colors">
            <X size={13} className="text-[var(--color-text-muted)]" />
          </button>
        </div>

        {/* Session detail row */}
        {session && (
          <div className="flex gap-3 px-3 py-1.5 border-b border-[var(--color-nexus-border)] text-[10px] font-mono text-[var(--color-text-muted)] shrink-0 overflow-x-auto">
            <span>mode:{session.mode}</span>
            <span>plan:{session.plan?.length ?? 0}</span>
            <span>result:{session.result ? '✓' : '—'}</span>
            <span>finalAnswer:{session.result?.finalAnswer?.length ?? 0}c</span>
            <span>stoppedBy:{session.stoppedBy ?? '—'}</span>
            <span>started:{new Date(session.startedAt).toISOString().slice(11, 19)}</span>
          </div>
        )}

        {/* Event log */}
        <div className="flex-1 overflow-y-auto px-3 py-1">
          {events.length === 0 ? (
            <p className="text-[10px] text-[var(--color-text-muted)] py-2 text-center">No events yet. Run a task to see live traces.</p>
          ) : (
            events.map(e => <EventRow key={e.id} e={e} />)
          )}
        </div>

        <div className="px-3 py-1.5 border-t border-[var(--color-nexus-border)] text-[10px] text-[var(--color-text-muted)] shrink-0">
          {events.length} events · newest first
        </div>
      </div>
    </>
  );
}
