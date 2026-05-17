import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Search, Terminal, LayoutDashboard, History, GitBranch,
  Brain, Bot, BarChart3, CreditCard, Settings, Workflow, X
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { cn } from '../../lib/utils';

type Page = 'workspace' | 'workflows' | 'dashboard' | 'history' | 'traces' | 'memory' | 'agents' | 'observability' | 'billing' | 'settings';

const COMMANDS = [
  { id: 'workspace',     label: 'Go to Workspace',     icon: Terminal,        page: 'workspace' as Page,     shortcut: '⌘1' },
  { id: 'workflows',     label: 'Go to Workflows',     icon: Workflow,        page: 'workflows' as Page,     shortcut: '⌘2' },
  { id: 'dashboard',     label: 'Go to Dashboard',     icon: LayoutDashboard, page: 'dashboard' as Page,     shortcut: '⌘3' },
  { id: 'history',       label: 'Go to History',        icon: History,         page: 'history' as Page,       shortcut: '⌘4' },
  { id: 'traces',        label: 'Go to Traces',         icon: GitBranch,       page: 'traces' as Page,        shortcut: '⌘5' },
  { id: 'memory',        label: 'Go to Memory',         icon: Brain,           page: 'memory' as Page,        shortcut: '⌘6' },
  { id: 'agents',        label: 'Go to Agents',         icon: Bot,             page: 'agents' as Page,        shortcut: '⌘7' },
  { id: 'observability', label: 'Go to Observability',  icon: BarChart3,       page: 'observability' as Page, shortcut: '⌘8' },
  { id: 'billing',       label: 'Go to Billing',        icon: CreditCard,      page: 'billing' as Page,       shortcut: '⌘9' },
  { id: 'settings',      label: 'Open Settings',        icon: Settings,        page: 'settings' as Page,      shortcut: '' },
];

export function CommandPalette() {
  const { commandOpen, setCommandOpen, setPage } = useAppStore();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query
    ? COMMANDS.filter(c => c.label.toLowerCase().includes(query.toLowerCase()))
    : COMMANDS;

  useEffect(() => {
    if (commandOpen) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandOpen]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  const select = (page: Page) => {
    setPage(page);
    setCommandOpen(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && filtered[selected]) select(filtered[selected].page);
  };

  return (
    <AnimatePresence>
      {commandOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setCommandOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className="fixed left-1/2 top-[20%] -translate-x-1/2 z-50 w-full max-w-lg"
          >
            <div className="glass rounded-xl overflow-hidden shadow-2xl border border-[var(--color-nexus-border-2)]">
              {/* Input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-nexus-border)]">
                <Search size={16} className="text-[var(--color-text-muted)] shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Search commands..."
                  className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none"
                />
                <button onClick={() => setCommandOpen(false)}>
                  <X size={14} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]" />
                </button>
              </div>

              {/* Results */}
              <div className="py-2 max-h-80 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="text-center text-sm text-[var(--color-text-muted)] py-8">No results</p>
                ) : (
                  filtered.map((cmd, i) => {
                    const Icon = cmd.icon;
                    return (
                      <button
                        key={cmd.id}
                        onClick={() => select(cmd.page)}
                        onMouseEnter={() => setSelected(i)}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors duration-75',
                          i === selected
                            ? 'bg-[var(--color-nexus-accent-3)] text-[var(--color-nexus-accent)]'
                            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-glass-hover)]'
                        )}
                      >
                        <Icon size={15} className="shrink-0" />
                        <span className="flex-1 text-left">{cmd.label}</span>
                        {cmd.shortcut && (
                          <kbd className="text-[10px] font-mono text-[var(--color-text-muted)]">{cmd.shortcut}</kbd>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="border-t border-[var(--color-nexus-border)] px-4 py-2 flex items-center gap-4 text-[10px] text-[var(--color-text-muted)]">
                <span><kbd className="font-mono">↑↓</kbd> navigate</span>
                <span><kbd className="font-mono">↵</kbd> select</span>
                <span><kbd className="font-mono">esc</kbd> close</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
