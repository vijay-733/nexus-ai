import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  add: (message: string, variant?: ToastVariant, duration?: number) => void;
  remove: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (message, variant = 'info', duration = 4000) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    set(s => ({ toasts: [...s.toasts, { id, message, variant, duration }] }));
    if (duration > 0) setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), duration);
  },
  remove: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));

export const toast = {
  success: (msg: string, dur?: number) => useToastStore.getState().add(msg, 'success', dur),
  error:   (msg: string, dur?: number) => useToastStore.getState().add(msg, 'error', dur),
  warning: (msg: string, dur?: number) => useToastStore.getState().add(msg, 'warning', dur),
  info:    (msg: string, dur?: number) => useToastStore.getState().add(msg, 'info', dur),
};
