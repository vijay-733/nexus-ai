import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard, Terminal, History, GitBranch, Brain,
  Bot, BarChart3, CreditCard, Settings, ChevronLeft,
  Cpu, Workflow, Zap,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAuthStore } from '../../store/authStore';
import { cn } from '../../lib/utils';
import { StatusDot } from '../ui/StatusDot';

import type { Page } from '../../store/appStore';

type NavSection = {
  label?: string;
  items: { id: Page; label: string; icon: React.ElementType; shortcut: string }[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { id: 'workspace',  label: 'Workspace',   icon: Terminal,        shortcut: '1' },
      { id: 'workflows',  label: 'Workflows',   icon: Workflow,        shortcut: '2' },
      { id: 'dashboard',  label: 'Dashboard',   icon: LayoutDashboard, shortcut: '3' },
      { id: 'history',    label: 'History',     icon: History,         shortcut: '4' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { id: 'traces',        label: 'Traces',        icon: GitBranch, shortcut: '5' },
      { id: 'memory',        label: 'Memory',        icon: Brain,     shortcut: '6' },
      { id: 'agents',        label: 'Agents',        icon: Bot,       shortcut: '7' },
      { id: 'observability', label: 'Observability', icon: BarChart3, shortcut: '8' },
    ],
  },
  {
    label: 'Account',
    items: [
      { id: 'billing', label: 'Billing', icon: CreditCard, shortcut: '9' },
    ],
  },
] as const;

export function Sidebar() {
  const { currentPage, setPage, sidebarOpen, setSidebarOpen, isRunning } = useAppStore();
  const { user } = useAuthStore();

  const creditPct = user?.credits != null
    ? Math.min(Math.max((user.credits / 100) * 100, 0), 100)
    : null;

  return (
    <motion.aside
      animate={{ width: sidebarOpen ? 228 : 54 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className="hidden md:flex flex-col h-full shrink-0 overflow-hidden"
      style={{
        background: 'var(--color-nexus-surface)',
        borderRight: '1px solid var(--color-nexus-border)',
      }}
    >
      {/* ── Logo ── */}
      <div className="h-[54px] flex items-center px-3 border-b border-[var(--color-nexus-border)] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
            style={{
              background: 'linear-gradient(135deg, rgba(0,229,160,0.15), rgba(79,142,247,0.08))',
              border: '1px solid rgba(0,229,160,0.2)',
              boxShadow: '0 0 16px rgba(0,229,160,0.1)',
            }}
          >
            <Cpu size={15} className="text-[var(--color-nexus-accent)]" />
          </div>
          <AnimatePresence mode="wait">
            {sidebarOpen && (
              <motion.div
                key="logo-text"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden whitespace-nowrap flex items-baseline gap-1"
              >
                <span className="font-bold text-sm text-[var(--color-text-primary)] tracking-tight">Nexus</span>
                <span className="gradient-text font-bold text-sm tracking-tight">AI</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 px-2 py-2.5 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si}>
            {/* Section label */}
            {section.label && sidebarOpen && (
              <p className="section-label mt-1">{section.label}</p>
            )}
            {section.label && !sidebarOpen && si > 0 && (
              <div className="my-2 mx-1 border-t border-[var(--color-nexus-border)]" />
            )}

            {section.items.map(({ id, label, icon: Icon, shortcut }) => {
              const active = currentPage === id;
              return (
                <button
                  key={id}
                  onClick={() => setPage(id)}
                  title={!sidebarOpen ? label : undefined}
                  className={cn(
                    'nav-item w-full',
                    active && 'active',
                    !sidebarOpen && 'justify-center px-0'
                  )}
                >
                  <div className="relative shrink-0">
                    <Icon size={15} />
                    {id === 'workspace' && isRunning && (
                      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[var(--color-nexus-amber)] animate-pulse" />
                    )}
                  </div>
                  <AnimatePresence mode="wait">
                    {sidebarOpen && (
                      <motion.span
                        key="label"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.12 }}
                        className="flex-1 text-left truncate"
                      >
                        {label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {sidebarOpen && (
                    <span className="text-[9px] text-[var(--color-text-muted)] font-mono shrink-0 opacity-50">
                      ⌘{shortcut}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Bottom section ── */}
      <div className="px-2 pt-2 pb-3 border-t border-[var(--color-nexus-border)] space-y-0.5 shrink-0">
        {/* Settings */}
        <button
          onClick={() => setPage('settings')}
          title={!sidebarOpen ? 'Settings' : undefined}
          className={cn(
            'nav-item w-full',
            currentPage === 'settings' && 'active',
            !sidebarOpen && 'justify-center px-0'
          )}
        >
          <Settings size={15} className="shrink-0" />
          <AnimatePresence mode="wait">
            {sidebarOpen && (
              <motion.span
                key="settings-label"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 text-left"
              >
                Settings
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        {/* Credits mini-widget (expanded only) */}
        <AnimatePresence>
          {sidebarOpen && user && creditPct != null && (
            <motion.div
              key="credits"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <button
                onClick={() => setPage('billing')}
                className="w-full flex flex-col gap-1.5 px-2.5 py-2 rounded-[9px] hover:bg-[var(--color-glass-hover)] transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Zap size={10} className="text-[var(--color-nexus-amber)]" />
                    <span className="text-[10px] text-[var(--color-text-muted)]">Credits</span>
                  </div>
                  <span className="text-[10px] font-mono font-semibold text-[var(--color-text-secondary)] group-hover:text-[var(--color-nexus-accent)] transition-colors">
                    {user.credits?.toLocaleString() ?? '—'}
                  </span>
                </div>
                <div className="credit-bar w-full">
                  <div
                    className="credit-bar-fill"
                    style={{
                      width: `${creditPct}%`,
                      background: creditPct > 20
                        ? 'linear-gradient(90deg, var(--color-nexus-accent), var(--color-nexus-blue))'
                        : 'var(--color-nexus-amber)',
                    }}
                  />
                </div>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* User chip */}
        {user && (
          <div className={cn(
            'flex items-center gap-2 px-2 py-1.5 rounded-[9px]',
            !sidebarOpen && 'justify-center'
          )}>
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, var(--color-nexus-accent), var(--color-nexus-blue))',
              }}
            >
              <span className="text-[10px] font-bold" style={{ color: 'var(--color-nexus-void)' }}>
                {(user.name ?? user.email)[0].toUpperCase()}
              </span>
            </div>
            <AnimatePresence mode="wait">
              {sidebarOpen && (
                <motion.div
                  key="user-info"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="min-w-0 flex-1"
                >
                  <p className="text-xs font-medium text-[var(--color-text-primary)] truncate leading-tight">
                    {user.name ?? user.email.split('@')[0]}
                  </p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <StatusDot status="active" size="sm" />
                    <span className="text-[10px] text-[var(--color-text-muted)] capitalize">{user.plan}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Collapse toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={cn('nav-item w-full mt-0.5', !sidebarOpen && 'justify-center px-0')}
        >
          <motion.div
            animate={{ rotate: sidebarOpen ? 0 : 180 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          >
            <ChevronLeft size={14} className="shrink-0 text-[var(--color-text-muted)]" />
          </motion.div>
          <AnimatePresence mode="wait">
            {sidebarOpen && (
              <motion.span
                key="collapse-label"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs text-[var(--color-text-muted)]"
              >
                Collapse
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.aside>
  );
}
