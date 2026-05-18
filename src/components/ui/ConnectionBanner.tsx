import { AnimatePresence, motion } from 'motion/react';
import { WifiOff, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConnectionState } from '../../hooks/useServerHealth';

export function ConnectionBanner({ state }: { state: ConnectionState }) {
  const qc = useQueryClient();

  if (state === 'connected' || state === 'checking') return null;

  const isOffline   = state === 'offline';
  const isSlow      = state === 'slow';
  const isDegraded  = state === 'degraded';

  const bgClass = isOffline
    ? 'bg-[rgba(239,68,68,0.08)] border-b border-[rgba(239,68,68,0.2)]'
    : 'bg-[rgba(245,158,11,0.08)] border-b border-[rgba(245,158,11,0.2)]';

  const textColor = isOffline
    ? 'text-[var(--color-nexus-red)]'
    : 'text-[var(--color-nexus-amber)]';

  const message = isOffline
    ? 'Backend server is offline. Run npm run server to start it.'
    : isSlow
    ? 'Server is waking up — free tier may take ~30s on first load…'
    : 'Connection degraded. Some features may not work.';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className={`shrink-0 overflow-hidden ${bgClass}`}
      >
        <div className="flex items-center gap-3 px-4 py-2">
          {isOffline
            ? <WifiOff  size={13} className="text-[var(--color-nexus-red)]   shrink-0" />
            : isSlow
            ? <Loader2  size={13} className="text-[var(--color-nexus-amber)] shrink-0 animate-spin" />
            : <AlertTriangle size={13} className="text-[var(--color-nexus-amber)] shrink-0" />
          }
          <p className={`text-xs flex-1 ${textColor}`}>{message}</p>
          {!isSlow && (
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ['server-health-ping'] })}
              className="text-xs flex items-center gap-1 opacity-70 hover:opacity-100 transition-opacity"
            >
              <RefreshCw size={11} />
              Retry
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
