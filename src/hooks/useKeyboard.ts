import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';

export function useKeyboard() {
  const { toggleCommand, setPage, currentPage } = useAppStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // ⌘K — command palette
      if (meta && e.key === 'k') {
        e.preventDefault();
        toggleCommand();
      }

      // ⌘1-8 — page shortcuts (when not in input)
      if (meta && !e.shiftKey) {
        const tagName = (e.target as HTMLElement)?.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA') return;

        const pages = ['workspace','workflows','dashboard','history','traces','memory','agents','observability','billing'] as const;
        const idx = parseInt(e.key) - 1;
        if (idx >= 0 && idx < pages.length) {
          e.preventDefault();
          setPage(pages[idx]);
        }
      }

      // Escape
      if (e.key === 'Escape') {
        useAppStore.getState().setCommandOpen(false);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleCommand, setPage, currentPage]);
}
