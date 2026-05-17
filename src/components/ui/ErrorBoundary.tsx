import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[200px] p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)] flex items-center justify-center mb-4">
            <AlertTriangle size={20} className="text-[var(--color-nexus-red)]" />
          </div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">Something went wrong</h3>
          <p className="text-xs text-[var(--color-text-muted)] mb-4 max-w-xs font-mono">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="flex items-center gap-2 text-sm text-[var(--color-nexus-accent)] hover:underline"
          >
            <RotateCcw size={13} />
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
