import { cn } from '../../lib/utils';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'surface' | 'elevated' | 'glass' | 'outline';
  hover?: boolean;
  onClick?: () => void;
}

export function Card({ children, className, variant = 'surface', hover, onClick }: CardProps) {
  const variants = {
    surface:  'bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[14px]',
    elevated: 'bg-[var(--color-nexus-elevated)] border border-[var(--color-nexus-border)] rounded-[14px]',
    glass:    'glass',
    outline:  'border border-[var(--color-nexus-border)] rounded-[14px] bg-transparent',
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        variants[variant],
        hover && 'card-hover',
        onClick && 'cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('px-5 py-4 border-b border-[var(--color-nexus-border)]', className)}>
      {children}
    </div>
  );
}

export function CardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('px-5 py-4', className)}>
      {children}
    </div>
  );
}
