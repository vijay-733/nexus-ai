import { motion } from 'motion/react';
import { ArrowRight, Play, Layers, GitBranch, Zap } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { WORKFLOW_PIPELINES } from './Workspace';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import type { RunMode } from '../store/appStore';

const MODE_COLOR: Record<string, string> = {
  orchestrate: 'accent',
  multi:       'blue',
  react:       'purple',
  image:       'purple',
};

const MODE_ICON: Record<string, React.ElementType> = {
  orchestrate: GitBranch,
  multi:       Layers,
  react:       Zap,
  image:       Zap,
};

export default function Workflows() {
  const { setPage, isRunning, setPendingTask } = useAppStore();

  function launchTask(task: string, mode: RunMode, label: string) {
    if (isRunning) return;
    setPendingTask(task, mode, label);
    setPage('workspace');
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Workflow Pipelines</h2>
        <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
          Pre-built multi-stage AI workflows for specialized domains. Click a task to launch it directly in the workspace.
        </p>
      </motion.div>

      {/* Pipeline grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {WORKFLOW_PIPELINES.map((pipeline, pi) => {
          const PipeIcon = pipeline.icon;
          const ModeIcon = MODE_ICON[pipeline.mode] ?? Zap;
          const modeColor = MODE_COLOR[pipeline.mode] ?? 'accent';

          return (
            <motion.div
              key={pipeline.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: pi * 0.06 }}
              className="surface rounded-2xl overflow-hidden flex flex-col"
            >
              {/* Card header */}
              <div className="px-5 py-4 border-b border-[var(--color-nexus-border)]">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[var(--color-nexus-elevated)] flex items-center justify-center shrink-0">
                    <PipeIcon size={18} className={`text-[var(--color-nexus-${pipeline.color})]`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-[var(--color-text-primary)]">{pipeline.label}</span>
                      <Badge variant={modeColor as any} size="sm">
                        <ModeIcon size={9} className="inline mr-0.5" />
                        {pipeline.mode}
                      </Badge>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1 leading-relaxed">{pipeline.desc}</p>
                  </div>
                </div>

                {/* Stage pipeline visualization */}
                <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                  {pipeline.stages.map((stage, i) => (
                    <span key={stage} className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-[var(--color-text-secondary)] px-2 py-1 rounded-lg bg-[var(--color-nexus-elevated)] border border-[var(--color-nexus-border)]">
                        {i + 1}. {stage}
                      </span>
                      {i < pipeline.stages.length - 1 && (
                        <ArrowRight size={11} className="text-[var(--color-text-muted)] opacity-50" />
                      )}
                    </span>
                  ))}
                </div>
              </div>

              {/* Task list */}
              <div className="flex-1 divide-y divide-[var(--color-nexus-border)]">
                {pipeline.tasks.map((task, ti) => (
                  <div key={ti} className="px-5 py-3.5 flex items-start gap-3 group hover:bg-[var(--color-glass-hover)] transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{task}</p>
                    </div>
                    <button
                      onClick={() => launchTask(task, pipeline.mode, pipeline.label)}
                      disabled={isRunning}
                      className="shrink-0 w-7 h-7 rounded-lg bg-[var(--color-nexus-elevated)] border border-[var(--color-nexus-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-nexus-accent)] hover:border-[var(--color-nexus-accent)] transition-colors disabled:opacity-40"
                      title="Launch in workspace"
                    >
                      <Play size={11} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-[var(--color-nexus-border)] flex items-center justify-between">
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {pipeline.stages.length} stages · {pipeline.tasks.length} templates
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setPage('workspace')}
                  className="gap-1 text-[var(--color-nexus-accent)] hover:text-[var(--color-nexus-accent)]"
                >
                  Open workspace
                  <ArrowRight size={11} />
                </Button>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Custom workflow hint */}
      <div className="surface rounded-xl p-5 flex items-center gap-4">
        <div className="flex-1">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">Custom workflow</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Any task you describe in the workspace automatically runs through the full agent orchestration pipeline — planning, execution, supervision, and memory.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setPage('workspace')} className="shrink-0 gap-1.5">
          Open workspace
          <ArrowRight size={13} />
        </Button>
      </div>
    </div>
  );
}
