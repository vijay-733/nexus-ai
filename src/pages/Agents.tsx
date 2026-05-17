import { useState } from 'react';
import { motion } from 'motion/react';
import {
  Bot, GitBranch, Brain, Shield, RotateCcw, Eye, Zap, Layers,
  Play, Info, ChevronDown, ChevronRight, Terminal
} from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { StatusDot } from '../components/ui/StatusDot';
import { useAppStore } from '../store/appStore';
import { agentApi, type AgentRunResult } from '../lib/api';
import { toast } from '../store/toastStore';
import { cn } from '../lib/utils';

interface AgentDef {
  id: string;
  name: string;
  icon: React.ElementType;
  color: string;
  description: string;
  tools: string[];
  mode: 'react' | 'multi' | 'orchestrate';
  exampleTask: string;
}

const AGENTS: AgentDef[] = [
  {
    id: 'orchestrator', name: 'Full Orchestrator',  icon: Layers,    color: 'accent',
    description: '8-agent pipeline: governance → planning → parallel execution → supervision → memory consolidation.',
    tools: ['all agents'],  mode: 'orchestrate',
    exampleTask: 'Research and write a comprehensive competitive analysis for a B2B SaaS product',
  },
  {
    id: 'planner',      name: 'Planner Agent',      icon: GitBranch, color: 'blue',
    description: 'Decomposes complex tasks into executable step plans with dependency management.',
    tools: ['memory-read', 'memory-write'], mode: 'multi',
    exampleTask: 'Create a detailed 90-day product launch plan with weekly milestones',
  },
  {
    id: 'text',         name: 'Text Agent',          icon: Zap,       color: 'accent',
    description: 'Expert writer and analyst. Generates, transforms, and analyzes text content.',
    tools: ['memory-read', 'research'], mode: 'react',
    exampleTask: 'Write a technical RFC for a microservices migration strategy',
  },
  {
    id: 'research',     name: 'Research Agent',      icon: Eye,       color: 'purple',
    description: 'Deep multi-source research with fact synthesis and confidence scoring.',
    tools: ['research', 'web-fetch', 'memory-write'], mode: 'react',
    exampleTask: 'Research the latest LLM fine-tuning techniques and summarize best practices',
  },
  {
    id: 'memory',       name: 'Memory Agent',        icon: Brain,     color: 'blue',
    description: 'Long-term memory management: storage, retrieval, compression, and context building.',
    tools: ['memory-read', 'memory-write', 'memory-delete'], mode: 'react',
    exampleTask: 'Summarize and compress the context from previous research sessions',
  },
  {
    id: 'multi',        name: 'Multi-Agent Runner',  icon: Layers,    color: 'purple',
    description: 'Parallel specialized agent execution with result aggregation.',
    tools: ['all worker agents'], mode: 'multi',
    exampleTask: 'Create a full landing page copy, SEO strategy, and social media campaign simultaneously',
  },
  {
    id: 'supervisor',   name: 'Supervisor Agent',    icon: Eye,       color: 'amber',
    description: 'Quality assurance: scores outputs, gates completion, and triggers revisions.',
    tools: ['memory-read'], mode: 'orchestrate',
    exampleTask: 'Review and score the quality of these 5 research summaries',
  },
  {
    id: 'recovery',     name: 'Recovery Agent',      icon: RotateCcw, color: 'amber',
    description: 'Fault tolerance with checkpoint-based recovery and automatic retry strategies.',
    tools: ['memory-read', 'memory-write'], mode: 'orchestrate',
    exampleTask: 'Retry the failed data analysis task and checkpoint progress every 3 steps',
  },
  {
    id: 'governance',   name: 'Governance Agent',    icon: Shield,    color: 'red',
    description: 'Policy enforcement, RBAC authorization, and compliance auditing.',
    tools: [], mode: 'orchestrate',
    exampleTask: 'Audit the last 10 agent runs for policy compliance',
  },
];

const colorVar: Record<string, string> = {
  accent: 'var(--color-nexus-accent)', blue: 'var(--color-nexus-blue)',
  purple: 'var(--color-nexus-purple)', amber: 'var(--color-nexus-amber)',
  red: 'var(--color-nexus-red)',
};
const badgeVar: Record<string, 'accent' | 'blue' | 'purple' | 'amber' | 'red'> = {
  accent: 'accent', blue: 'blue', purple: 'purple', amber: 'amber', red: 'red',
};

function AgentCard({ agent }: { agent: AgentDef }) {
  const [expanded, setExpanded] = useState(false);
  const [running, setRunning] = useState(false);
  const { startSession, completeSession, failSession, setPage } = useAppStore();

  const handleRun = async () => {
    setRunning(true);
    const id = startSession(agent.exampleTask, agent.mode);
    try {
      let result: AgentRunResult;
      if (agent.mode === 'orchestrate') result = await agentApi.orchestrate(agent.exampleTask);
      else if (agent.mode === 'multi')  result = await agentApi.multi(agent.exampleTask);
      else                              result = await agentApi.react(agent.exampleTask);
      completeSession(id, result);
      toast.success(`${agent.name} completed`);
      setPage('workspace');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Agent failed';
      failSession(id, msg);
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  };

  const Icon = agent.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="surface rounded-xl overflow-hidden hover:border-[var(--color-nexus-border-2)] transition-colors"
    >
      <div className="p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-nexus-elevated)] border border-[var(--color-nexus-border)] flex items-center justify-center shrink-0">
            <Icon size={18} style={{ color: colorVar[agent.color] }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{agent.name}</h3>
              <Badge variant={badgeVar[agent.color] ?? 'default'} size="sm">{agent.id}</Badge>
              <StatusDot status="active" size="sm" className="ml-auto" />
            </div>
            <Badge variant="outline" size="sm" className="mt-1">{agent.mode}</Badge>
          </div>
        </div>

        <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-3">
          {agent.description}
        </p>

        {agent.tools.length > 0 && (
          <div className="flex gap-1 flex-wrap mb-3">
            {agent.tools.map(t => (
              <Badge key={t} variant="outline" size="sm">{t}</Badge>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            loading={running}
            onClick={handleRun}
            className="gap-1.5"
          >
            <Play size={12} />
            Run Example
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="gap-1"
          >
            <Info size={12} />
            Example task
            <ChevronDown size={11} className={cn('transition-transform duration-150', expanded && 'rotate-180')} />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[var(--color-nexus-border)] px-5 py-3 bg-[var(--color-nexus-void)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5">Example task</p>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{agent.exampleTask}</p>
          <button
            onClick={() => { useAppStore.getState().setPage('workspace'); }}
            className="mt-2 flex items-center gap-1 text-xs text-[var(--color-nexus-accent)] hover:underline"
          >
            <Terminal size={11} />
            Run custom task in Workspace
          </button>
        </div>
      )}
    </motion.div>
  );
}

export default function Agents() {
  const { isRunning } = useAppStore();

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Agent Registry</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            {AGENTS.length} agents — click <strong className="text-[var(--color-text-secondary)]">Run Example</strong> to launch with a sample task, or run custom tasks from the Workspace.
          </p>
        </div>
        {isRunning && (
          <Badge variant="amber" className="shrink-0">Agent running...</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {AGENTS.map(a => <AgentCard key={a.id} agent={a} />)}
      </div>
    </div>
  );
}
