import { useEffect, useState } from 'react';
import { Search, LogOut, Menu, Zap, ChevronRight } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAuthStore } from '../../store/authStore';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

const PAGE_META: Record<string, { label: string; parent?: string }> = {
  workspace:     { label: 'Workspace' },
  workflows:     { label: 'Workflows' },
  dashboard:     { label: 'Dashboard' },
  history:       { label: 'History',         parent: 'Dashboard' },
  traces:        { label: 'Traces',          parent: 'Intelligence' },
  memory:        { label: 'Memory',          parent: 'Intelligence' },
  agents:        { label: 'Agents',          parent: 'Intelligence' },
  observability: { label: 'Observability',   parent: 'Intelligence' },
  billing:       { label: 'Billing',         parent: 'Account' },
  settings:      { label: 'Settings',        parent: 'Account' },
};

const MODE_COLOR: Record<string, string> = {
  orchestrate: 'var(--color-nexus-accent)',
  multi:       'var(--color-nexus-blue)',
  react:       'var(--color-nexus-purple)',
  image:       'var(--color-nexus-purple)',
};

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [s, setS] = useState(Math.floor((Date.now() - startedAt) / 1000));
  useEffect(() => {
    const id = setInterval(() => setS(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return <span className="font-mono tabular-nums">{mm}:{ss}</span>;
}

export function TopBar() {
  const { currentPage, toggleCommand, toggleMobileNav, isRunning, currentSession } = useAppStore();
  const { user, logout } = useAuthStore();
  const meta = PAGE_META[currentPage] ?? { label: 'Nexus AI' };

  return (
    <header
      className="h-[54px] flex items-center gap-3 px-4 shrink-0"
      style={{
        background: 'var(--color-nexus-surface)',
        borderBottom: '1px solid var(--color-nexus-border)',
      }}
    >
      {/* Mobile hamburger */}
      <button
        className="md:hidden text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        onClick={toggleMobileNav}
      >
        <Menu size={18} />
      </button>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {meta.parent && (
          <>
            <span className="text-xs text-[var(--color-text-muted)] hidden sm:inline">{meta.parent}</span>
            <ChevronRight size={12} className="text-[var(--color-text-muted)] hidden sm:inline" />
          </>
        )}
        <h1 className="font-semibold text-sm text-[var(--color-text-primary)] tracking-tight">
          {meta.label}
        </h1>

        {/* Live execution badge */}
        {isRunning && currentSession && (
          <div
            className="hidden sm:flex items-center gap-2 ml-2 px-2.5 py-1 rounded-lg text-xs"
            style={{
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.18)',
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: 'var(--color-nexus-amber)' }}
            />
            <span className="text-[var(--color-nexus-amber)] font-medium capitalize">{currentSession.mode}</span>
            <span className="text-[var(--color-text-muted)]">·</span>
            <span className="text-[var(--color-text-muted)]">
              <ElapsedTimer startedAt={currentSession.startedAt} />
            </span>
          </div>
        )}
      </div>

      {/* Search */}
      <button
        onClick={toggleCommand}
        className={cn(
          'hidden sm:flex items-center gap-2 h-8 px-3 rounded-[9px] text-xs transition-all duration-150',
          'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
        )}
        style={{
          background: 'var(--color-nexus-elevated)',
          border: '1px solid var(--color-nexus-border)',
        }}
      >
        <Search size={12} />
        <span>Search</span>
        <kbd
          className="ml-1 text-[9px] font-mono px-1.5 py-0.5 rounded-md"
          style={{
            background: 'var(--color-nexus-border)',
            color: 'var(--color-text-muted)',
          }}
        >
          ⌘K
        </kbd>
      </button>

      {/* Credits chip */}
      {user?.credits != null && (
        <div
          className="hidden lg:flex items-center gap-1.5 px-2.5 h-7 rounded-lg"
          style={{
            background: 'var(--color-nexus-elevated)',
            border: '1px solid var(--color-nexus-border)',
          }}
        >
          <Zap size={11} style={{ color: 'var(--color-nexus-amber)' }} />
          <span className="text-xs font-mono tabular-nums text-[var(--color-text-secondary)]">
            {user.credits.toLocaleString()}
          </span>
        </div>
      )}

      {/* Sign out */}
      <Button
        variant="ghost"
        size="sm"
        className="w-8 h-8 p-0 rounded-lg"
        style={{ color: 'var(--color-text-secondary)' } as React.CSSProperties}
        onClick={logout}
        title="Sign out"
      >
        <LogOut size={14} />
      </Button>
    </header>
  );
}
