import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Cpu, Terminal, GitBranch, Layers, Zap, CheckCircle2,
  ArrowRight, ArrowLeft, Brain, Shield, Bot, Sparkles
} from 'lucide-react';
import { useOnboardingStore } from '../store/onboardingStore';
import { useAppStore } from '../store/appStore';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { cn } from '../lib/utils';

const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Nexus AI',
    subtitle: 'A distributed AI agent operating system',
    content: (
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
          Nexus AI orchestrates specialized AI agents to complete complex tasks end-to-end —
          from research and writing to code generation and analysis.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: Bot,      label: '9 Specialized Agents',   color: 'accent'  },
            { icon: GitBranch,label: 'Multi-Agent Orchestration', color: 'blue' },
            { icon: Brain,    label: 'Persistent Memory',      color: 'purple'  },
            { icon: Shield,   label: 'Governance + Audit',     color: 'amber'   },
          ].map(({ icon: Icon, label, color }) => (
            <div key={label} className="surface rounded-xl p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--color-nexus-elevated)] flex items-center justify-center shrink-0">
                <Icon size={15} style={{ color: `var(--color-nexus-${color})` }} />
              </div>
              <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'modes',
    title: 'Choose your execution mode',
    subtitle: 'Three ways to run AI agents',
    content: (
      <div className="space-y-3">
        {[
          {
            icon: GitBranch, mode: 'orchestrate', color: 'accent', recommended: true,
            label: 'Orchestrate', speed: 'Thorough',
            desc: '8-agent pipeline: governance → planning → parallel execution → quality review → memory. Best for complex, high-stakes tasks.',
          },
          {
            icon: Layers, mode: 'multi', color: 'blue', recommended: false,
            label: 'Multi-Agent', speed: 'Balanced',
            desc: 'Planner decomposes task into parallel specialist agents. Great for tasks with clear subtasks.',
          },
          {
            icon: Zap, mode: 'react', color: 'purple', recommended: false,
            label: 'ReAct', speed: 'Fastest',
            desc: 'Single agent with Think → Act → Observe loop. Best for quick, focused tasks.',
          },
        ].map(({ icon: Icon, label, mode, color, recommended, speed, desc }) => (
          <div key={mode} className={cn('surface rounded-xl p-4 relative', recommended && 'border-[var(--color-nexus-accent)]')}>
            {recommended && (
              <div className="absolute -top-2 left-4">
                <Badge variant="accent" size="sm">Recommended</Badge>
              </div>
            )}
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--color-nexus-elevated)] flex items-center justify-center shrink-0 mt-0.5">
                <Icon size={16} style={{ color: `var(--color-nexus-${color})` }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">{label}</span>
                  <Badge variant="outline" size="sm">{speed}</Badge>
                </div>
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">{desc}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'first-task',
    title: "You're ready. Run your first task.",
    subtitle: 'Pick a starter or write your own',
    content: (
      <div className="space-y-3">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Describe any task in plain language. Nexus AI handles the rest.
        </p>
        <div className="space-y-2">
          {[
            'Research the pros and cons of microservices vs monolith architectures',
            'Write a Python script that reads a CSV and generates a summary report',
            'Create a marketing email campaign for a new SaaS product launch',
            'Explain how transformer attention mechanisms work with examples',
          ].map((task, i) => (
            <div
              key={i}
              className="surface rounded-xl p-3 flex items-start gap-3 hover:border-[var(--color-nexus-border-2)] transition-colors cursor-default"
            >
              <Sparkles size={12} className="text-[var(--color-nexus-accent)] mt-0.5 shrink-0" />
              <span className="text-xs text-[var(--color-text-secondary)]">{task}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)]">
          These are just examples — the Workspace accepts any task you describe.
        </p>
      </div>
    ),
  },
];

export default function Onboarding() {
  const { currentStep, setStep, complete } = useOnboardingStore();
  const { setPage } = useAppStore();
  const [direction, setDirection] = useState(1);

  const step = STEPS[currentStep];
  const isLast = currentStep === STEPS.length - 1;
  const isFirst = currentStep === 0;

  const go = (next: number) => {
    setDirection(next > currentStep ? 1 : -1);
    setStep(next);
  };

  const finish = () => {
    complete();
    setPage('workspace');
  };

  return (
    <div className="min-h-screen bg-[var(--color-nexus-dark)] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[var(--color-nexus-glow-lg)] blur-[140px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-nexus-accent-3)] border border-[rgba(0,229,160,0.2)] flex items-center justify-center glow-accent">
            <Cpu size={18} className="text-[var(--color-nexus-accent)]" />
          </div>
          <span className="font-bold text-[var(--color-text-primary)]">Nexus <span className="gradient-text">AI</span></span>
          <Badge variant="accent" size="sm" className="ml-auto">Setup</Badge>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 mb-6">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={cn(
                'h-1 rounded-full transition-all duration-300',
                i === currentStep ? 'flex-1 bg-[var(--color-nexus-accent)]' :
                i < currentStep  ? 'w-8 bg-[rgba(0,229,160,0.4)]' :
                                   'flex-1 bg-[var(--color-nexus-border)]'
              )}
            />
          ))}
        </div>

        {/* Card */}
        <div className="glass rounded-2xl p-6 min-h-[420px] flex flex-col">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step.id}
              custom={direction}
              initial={{ opacity: 0, x: direction * 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -30 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="flex-1 flex flex-col"
            >
              <div className="mb-5">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1">
                  Step {currentStep + 1} of {STEPS.length}
                </p>
                <h2 className="text-xl font-bold text-[var(--color-text-primary)]">{step.title}</h2>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">{step.subtitle}</p>
              </div>
              <div className="flex-1 overflow-y-auto">{step.content}</div>
            </motion.div>
          </AnimatePresence>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-5 border-t border-[var(--color-nexus-border)] mt-5">
            {!isFirst && (
              <Button variant="ghost" size="sm" onClick={() => go(currentStep - 1)} className="gap-1.5">
                <ArrowLeft size={13} />
                Back
              </Button>
            )}
            <div className="flex-1" />
            {isLast ? (
              <Button variant="primary" size="md" onClick={finish} className="gap-1.5">
                Open Workspace
                <Terminal size={14} />
              </Button>
            ) : (
              <Button variant="primary" size="md" onClick={() => go(currentStep + 1)} className="gap-1.5">
                Next
                <ArrowRight size={14} />
              </Button>
            )}
          </div>
        </div>

        <button
          onClick={finish}
          className="mt-3 w-full text-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          Skip setup — go straight to Workspace
        </button>
      </div>
    </div>
  );
}
