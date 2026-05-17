import { cn } from '../../lib/utils';

type Status = 'idle' | 'active' | 'planning' | 'running' | 'done' | 'error' | 'warning';

const colors: Record<Status, string> = {
  idle:     'bg-[var(--color-nexus-muted)]',
  active:   'bg-[var(--color-nexus-accent)]',
  planning: 'bg-[var(--color-nexus-blue)]',
  running:  'bg-[var(--color-nexus-amber)]',
  done:     'bg-[var(--color-nexus-green)]',
  error:    'bg-[var(--color-nexus-red)]',
  warning:  'bg-[var(--color-nexus-amber)]',
};

const pulseColors: Record<Status, string> = {
  idle:     '',
  active:   'animate-pulse-ring',
  planning: '',
  running:  'animate-pulse',
  done:     '',
  error:    '',
  warning:  'animate-pulse',
};

interface StatusDotProps {
  status: Status;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function StatusDot({ status, size = 'md', className }: StatusDotProps) {
  const sizes = { sm: 'w-1.5 h-1.5', md: 'w-2 h-2', lg: 'w-2.5 h-2.5' };
  return (
    <span
      className={cn(
        'inline-block rounded-full shrink-0',
        sizes[size],
        colors[status],
        pulseColors[status],
        className
      )}
    />
  );
}
