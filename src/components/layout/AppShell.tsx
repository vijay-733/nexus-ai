import { useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import { useKeyboard } from '../../hooks/useKeyboard';
import { useServerHealth } from '../../hooks/useServerHealth';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { CommandPalette } from './CommandPalette';
import { MobileNav } from './MobileNav';
import { ToastContainer } from '../ui/Toast';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { ErrorBoundary } from '../ui/ErrorBoundary';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { setMobile } = useAppStore();
  const connectionState = useServerHealth();
  useKeyboard();

  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [setMobile]);

  return (
    <div className="flex h-screen bg-[var(--color-nexus-dark)] overflow-hidden">
      <Sidebar />
      <MobileNav />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <ConnectionBanner state={connectionState} />
        <TopBar />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </div>

      <CommandPalette />
      <ToastContainer />
    </div>
  );
}
