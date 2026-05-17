import { cn } from '../../lib/utils';
import { Button } from './Button';

interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void; variant?: 'primary' | 'secondary' };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center py-16 px-6', className)}>
      <div className="w-14 h-14 rounded-2xl bg-[var(--color-nexus-elevated)] border border-[var(--color-nexus-border)] flex items-center justify-center mb-5">
        <Icon size={24} className="text-[var(--color-text-muted)]" />
      </div>
      <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-2">{title}</h3>
      <p className="text-sm text-[var(--color-text-muted)] max-w-xs leading-relaxed mb-6">{description}</p>
      {action && (
        <Button variant={action.variant ?? 'secondary'} size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
