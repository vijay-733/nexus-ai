import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, CheckCircle2, XCircle, Clock, Loader2, Cpu, Brain, Search, Globe, Image } from 'lucide-react';
import type { StepResult } from '../../lib/api';
import { Badge } from '../ui/Badge';
import { StatusDot } from '../ui/StatusDot';
import { StreamingText } from './StreamingText';
import { cn } from '../../lib/utils';

const TOOL_ICONS: Record<string, React.ElementType> = {
  'memory-read':  Brain,
  'memory-write': Brain,
  'research':     Search,
  'web-fetch':    Globe,
  'image-gen':    Image,
};

function statusIcon(status: string) {
  if (status === 'done')    return <CheckCircle2 size={14} className="text-[var(--color-nexus-green)]" />;
  if (status === 'error')   return <XCircle size={14} className="text-[var(--color-nexus-red)]" />;
  if (status === 'running') return <Loader2 size={14} className="text-[var(--color-nexus-amber)] animate-spin" />;
  return <Clock size={14} className="text-[var(--color-text-muted)]" />;
}

interface StepCardProps {
  step: StepResult;
  index: number;
}

export function StepCard({ step, index }: StepCardProps) {
  const [expanded, setExpanded] = useState(step.status === 'error');

  const ToolIcon = step.tool ? (TOOL_ICONS[step.tool] ?? Cpu) : Cpu;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
      className="surface rounded-xl overflow-hidden animate-node-appear"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-glass-hover)] transition-colors"
      >
        <div className="w-6 h-6 rounded-md bg-[var(--color-nexus-elevated)] border border-[var(--color-nexus-border)] flex items-center justify-center shrink-0">
          <ToolIcon size={13} className="text-[var(--color-text-secondary)]" />
        </div>

        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
              {step.agentType ?? `Step ${index + 1}`}
            </span>
            {step.tool && <Badge variant="outline" size="sm">{step.tool}</Badge>}
          </div>
          {step.input && (
            <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">{step.input}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {step.durationMs && (
            <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
              {(step.durationMs / 1000).toFixed(1)}s
            </span>
          )}
          {step.tokens && (
            <Badge variant="default" size="sm">{step.tokens.toLocaleString()} tok</Badge>
          )}
          {statusIcon(step.status)}
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.15 }}>
            <ChevronDown size={14} className="text-[var(--color-text-muted)]" />
          </motion.div>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-[var(--color-nexus-border)]"
          >
            <div className="px-4 py-3 space-y-3">
              {step.reasoning && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5">Reasoning</p>
                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{step.reasoning}</p>
                </div>
              )}
              {step.output && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5">Output</p>
                  <StreamingText
                    content={typeof step.output === 'string' ? step.output : JSON.stringify(step.output, null, 2)}
                    markdown={typeof step.output === 'string'}
                  />
                </div>
              )}
              {step.error && (
                <div className="bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.15)] rounded-lg p-3">
                  <p className="text-xs text-[var(--color-nexus-red)] font-mono">{step.error}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
