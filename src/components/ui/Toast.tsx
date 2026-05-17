import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useToastStore } from '../../store/toastStore';
import type { ToastVariant } from '../../store/toastStore';
import { cn } from '../../lib/utils';

const ICONS: Record<ToastVariant, React.ElementType> = {
  success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info,
};
const STYLES: Record<ToastVariant, string> = {
  success: 'border-[var(--color-nexus-green)] bg-[rgba(34,197,94,0.08)] text-[var(--color-nexus-green)]',
  error:   'border-[var(--color-nexus-red)] bg-[rgba(239,68,68,0.08)] text-[var(--color-nexus-red)]',
  warning: 'border-[var(--color-nexus-amber)] bg-[rgba(245,158,11,0.08)] text-[var(--color-nexus-amber)]',
  info:    'border-[var(--color-nexus-blue)] bg-[rgba(79,142,247,0.08)] text-[var(--color-nexus-blue)]',
};

export function ToastContainer() {
  const { toasts, remove } = useToastStore();
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => {
          const Icon = ICONS[t.variant];
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className={cn(
                'pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border',
                'backdrop-filter backdrop-blur-xl shadow-xl',
                STYLES[t.variant]
              )}
            >
              <Icon size={16} className="shrink-0 mt-0.5" />
              <span className="flex-1 text-sm font-medium text-[var(--color-text-primary)]">{t.message}</span>
              <button onClick={() => remove(t.id)} className="shrink-0 opacity-60 hover:opacity-100">
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
