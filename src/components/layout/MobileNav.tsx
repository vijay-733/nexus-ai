import { AnimatePresence, motion } from 'motion/react';
import {
  Terminal, LayoutDashboard, History, GitBranch,
  Brain, Bot, BarChart3, CreditCard, Settings, X, Workflow
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { cn } from '../../lib/utils';

const NAV_ITEMS = [
  { id: 'workspace',     label: 'Workspace',     icon: Terminal },
  { id: 'workflows',     label: 'Workflows',     icon: Workflow },
  { id: 'dashboard',     label: 'Dashboard',     icon: LayoutDashboard },
  { id: 'history',       label: 'History',        icon: History },
  { id: 'traces',        label: 'Traces',         icon: GitBranch },
  { id: 'memory',        label: 'Memory',         icon: Brain },
  { id: 'agents',        label: 'Agents',         icon: Bot },
  { id: 'observability', label: 'Observability',  icon: BarChart3 },
  { id: 'billing',       label: 'Billing',        icon: CreditCard },
  { id: 'settings',      label: 'Settings',       icon: Settings },
] as const;

export function MobileNav() {
  const { mobileNavOpen, toggleMobileNav, currentPage, setPage } = useAppStore();

  return (
    <AnimatePresence>
      {mobileNavOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={toggleMobileNav}
            className="md:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="md:hidden fixed inset-y-0 left-0 z-50 w-72 bg-[var(--color-nexus-surface)] border-r border-[var(--color-nexus-border)] flex flex-col"
          >
            <div className="h-14 flex items-center justify-between px-4 border-b border-[var(--color-nexus-border)]">
              <span className="font-bold text-[var(--color-text-primary)]">Nexus <span className="gradient-text">AI</span></span>
              <button onClick={toggleMobileNav} className="text-[var(--color-text-muted)]">
                <X size={20} />
              </button>
            </div>
            <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
              {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setPage(id)}
                  className={cn('nav-item w-full', currentPage === id && 'active')}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
