import { useState, useRef, useEffect } from 'react';
import { Send, Zap, Layers, GitBranch, Image, ChevronDown, Sparkles } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import type { RunMode } from '../../store/appStore';

const MODES: { id: RunMode; label: string; icon: React.ElementType; description: string; color: string }[] = [
  { id: 'orchestrate', label: 'Orchestrate', icon: GitBranch, description: 'Full 8-agent pipeline',   color: 'var(--color-nexus-accent)'  },
  { id: 'multi',       label: 'Multi-Agent', icon: Layers,    description: 'Parallel specialists',    color: 'var(--color-nexus-blue)'    },
  { id: 'react',       label: 'ReAct',       icon: Zap,       description: 'Think → act → observe',   color: 'var(--color-nexus-purple)'  },
  { id: 'image',       label: 'Image',       icon: Image,     description: 'Generate visual assets',  color: 'var(--color-nexus-purple)'  },
];

const PLACEHOLDER_TASKS = [
  'Write a Python FastAPI server with JWT auth and rate limiting…',
  'Research the latest advances in LLM agent architectures…',
  'Create a go-to-market strategy for a developer tools startup…',
  'Generate a futuristic AI workspace interior image…',
  'Analyze competitive landscape for B2B SaaS tools in 2024…',
];

interface AgentInputProps {
  onSubmit: (task: string, mode: RunMode) => void;
  isRunning: boolean;
  mode: RunMode;
  onModeChange: (mode: RunMode) => void;
}

export function AgentInput({ onSubmit, isRunning, mode, onModeChange }: AgentInputProps) {
  const [value, setValue] = useState('');
  const [showModes, setShowModes] = useState(false);
  const [placeholder] = useState(() => PLACEHOLDER_TASKS[Math.floor(Math.random() * PLACEHOLDER_TASKS.length)]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentMode = MODES.find(m => m.id === mode) ?? MODES[0];

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
  }, [value]);

  // Auto-focus on mount
  useEffect(() => {
    if (!isRunning) textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close mode dropdown on outside click
  useEffect(() => {
    if (!showModes) return;
    const handler = () => setShowModes(false);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModes]);

  const handleSubmit = () => {
    const task = value.trim();
    if (!task || isRunning) return;
    onSubmit(task, mode);
    setValue('');
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="relative">
      <div
        className={cn('input-premium transition-all duration-200', isRunning && 'opacity-60')}
        onClick={() => !isRunning && textareaRef.current?.focus()}
      >
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKey}
          disabled={isRunning}
          placeholder={placeholder}
          rows={1}
          className={cn(
            'w-full bg-transparent text-sm text-[var(--color-text-primary)] leading-relaxed',
            'placeholder-[var(--color-text-placeholder)] resize-none outline-none',
            'px-4 pt-4 pb-3 min-h-[56px] max-h-[220px]'
          )}
        />

        {/* Toolbar row */}
        <div className="flex items-center justify-between px-3 pb-3 gap-2">

          {/* Mode selector */}
          <div className="relative" onMouseDown={e => e.stopPropagation()}>
            <button
              onClick={() => !isRunning && setShowModes(v => !v)}
              disabled={isRunning}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-xs transition-all duration-150',
                'border hover:border-[var(--color-nexus-border-2)]',
                showModes
                  ? 'bg-[var(--color-nexus-elevated)] border-[var(--color-nexus-border-2)] text-[var(--color-text-primary)]'
                  : 'bg-[var(--color-nexus-elevated)] border-[var(--color-nexus-border)] text-[var(--color-text-secondary)]',
              )}
            >
              <currentMode.icon size={12} style={{ color: currentMode.color }} />
              <span className="font-medium">{currentMode.label}</span>
              <ChevronDown
                size={10}
                className={cn('transition-transform duration-150', showModes && 'rotate-180')}
              />
            </button>

            {showModes && (
              <div
                className="absolute bottom-full mb-2 left-0 z-20 rounded-[12px] overflow-hidden min-w-[220px] animate-slide-up"
                style={{
                  background: 'var(--color-nexus-popup)',
                  border: '1px solid var(--color-nexus-border-2)',
                  boxShadow: '0 16px 48px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.3)',
                }}
              >
                <div className="p-1.5 space-y-0.5">
                  {MODES.map(m => (
                    <button
                      key={m.id}
                      onClick={() => { onModeChange(m.id); setShowModes(false); }}
                      className={cn(
                        'w-full flex items-start gap-3 px-3 py-2.5 rounded-[9px] text-left transition-colors',
                        m.id === mode
                          ? 'bg-[var(--color-nexus-elevated)]'
                          : 'hover:bg-[var(--color-glass-hover)]'
                      )}
                    >
                      <div
                        className="w-6 h-6 rounded-[7px] flex items-center justify-center shrink-0 mt-0.5"
                        style={{
                          background: m.id === mode ? `${m.color}18` : 'var(--color-nexus-elevated)',
                          border: `1px solid ${m.id === mode ? `${m.color}30` : 'var(--color-nexus-border)'}`,
                        }}
                      >
                        <m.icon size={12} style={{ color: m.id === mode ? m.color : 'var(--color-text-muted)' }} />
                      </div>
                      <div className="min-w-0">
                        <p
                          className="text-xs font-semibold leading-tight"
                          style={{ color: m.id === mode ? m.color : 'var(--color-text-primary)' }}
                        >
                          {m.label}
                        </p>
                        <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{m.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {value.length > 0 && (
              <span className="text-[10px] text-[var(--color-text-muted)] hidden sm:block tabular-nums">
                {value.length} chars · ⇧↵ new line
              </span>
            )}
            {value.length === 0 && (
              <span className="text-[10px] text-[var(--color-text-muted)] hidden sm:flex items-center gap-1">
                <Sparkles size={9} className="opacity-50" />
                ⇧↵ new line
              </span>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={!value.trim() || isRunning}
              loading={isRunning}
              className="gap-1.5 h-8 px-4"
            >
              {!isRunning && <Send size={12} />}
              {isRunning ? 'Running…' : 'Run'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
