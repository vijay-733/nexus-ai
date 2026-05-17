import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'glass';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', loading, disabled, children, ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center gap-2 font-medium rounded-[10px] ' +
      'transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed select-none ' +
      'active:scale-[0.98]';

    const variants: Record<string, string> = {
      primary:
        'bg-[var(--color-nexus-accent)] text-[var(--color-nexus-void)] ' +
        'hover:bg-[var(--color-nexus-accent-2)] ' +
        'shadow-[0_0_20px_rgba(0,229,160,0.25)] hover:shadow-[0_0_28px_rgba(0,229,160,0.35)] ' +
        'font-semibold tracking-tight',
      secondary:
        'bg-[var(--color-glass)] border border-[var(--color-glass-border)] ' +
        'text-[var(--color-text-primary)] ' +
        'hover:bg-[var(--color-glass-hover)] hover:border-[var(--color-nexus-border-2)]',
      ghost:
        'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] ' +
        'hover:bg-[var(--color-glass-hover)]',
      danger:
        'bg-[var(--color-nexus-red-dim)] border border-[rgba(240,76,94,0.2)] ' +
        'text-[var(--color-nexus-red)] hover:bg-[rgba(240,76,94,0.18)]',
      outline:
        'border border-[var(--color-nexus-accent)] text-[var(--color-nexus-accent)] ' +
        'hover:bg-[var(--color-nexus-accent-3)]',
      glass:
        'bg-[rgba(255,255,255,0.04)] border border-[var(--color-glass-border)] ' +
        'text-[var(--color-text-secondary)] backdrop-blur-sm ' +
        'hover:bg-[var(--color-glass-hover)] hover:text-[var(--color-text-primary)] ' +
        'hover:border-[var(--color-nexus-border-2)]',
    };

    const sizes: Record<string, string> = {
      xs: 'text-[11px] px-2 py-0.5 h-6',
      sm: 'text-xs px-3 py-1.5 h-8',
      md: 'text-sm px-4 py-2 h-9',
      lg: 'text-sm px-5 py-2.5 h-11',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading && (
          <svg className="animate-spin w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
