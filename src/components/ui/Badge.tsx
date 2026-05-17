import { cn } from '../../lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'accent' | 'blue' | 'purple' | 'amber' | 'red' | 'green' | 'outline';
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({ children, variant = 'default', size = 'md', className }: BadgeProps) {
  const base = 'inline-flex items-center gap-1 font-medium rounded-full border';
  const variants = {
    default: 'bg-[var(--color-nexus-elevated)] border-[var(--color-nexus-border)] text-[var(--color-text-secondary)]',
    accent:  'bg-[var(--color-nexus-accent-3)] border-[rgba(0,229,160,0.2)] text-[var(--color-nexus-accent)]',
    blue:    'bg-[rgba(79,142,247,0.1)] border-[rgba(79,142,247,0.2)] text-[var(--color-nexus-blue)]',
    purple:  'bg-[rgba(139,92,246,0.1)] border-[rgba(139,92,246,0.2)] text-[var(--color-nexus-purple)]',
    amber:   'bg-[rgba(245,158,11,0.1)] border-[rgba(245,158,11,0.2)] text-[var(--color-nexus-amber)]',
    red:     'bg-[rgba(239,68,68,0.1)] border-[rgba(239,68,68,0.2)] text-[var(--color-nexus-red)]',
    green:   'bg-[rgba(34,197,94,0.1)] border-[rgba(34,197,94,0.2)] text-[var(--color-nexus-green)]',
    outline: 'bg-transparent border-[var(--color-nexus-border-2)] text-[var(--color-text-secondary)]',
  };
  const sizes = { sm: 'text-xs px-1.5 py-0.5', md: 'text-xs px-2 py-0.5' };
  return (
    <span className={cn(base, variants[variant], sizes[size], className)}>
      {children}
    </span>
  );
}
