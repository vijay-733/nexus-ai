import { lazy, Suspense, memo, useMemo } from 'react';
import { useAuthStore } from './store/authStore';
import { useOnboardingStore } from './store/onboardingStore';
import { useAppStore } from './store/appStore';
import { AppShell } from './components/layout/AppShell';
import Auth from './pages/Auth';
import Onboarding from './pages/Onboarding';

const Dashboard    = lazy(() => import('./pages/Dashboard'));
const Workspace    = lazy(() => import('./pages/Workspace'));
const Workflows    = lazy(() => import('./pages/Workflows'));
const History      = lazy(() => import('./pages/History'));
const Traces       = lazy(() => import('./pages/Traces'));
const Memory       = lazy(() => import('./pages/Memory'));
const Agents       = lazy(() => import('./pages/Agents'));
const Observability = lazy(() => import('./pages/Observability'));
const Billing      = lazy(() => import('./pages/Billing'));
const Settings     = lazy(() => import('./pages/Settings'));

const PageFallback = () => (
  <div className="flex items-center justify-center h-full">
    <div className="w-6 h-6 rounded-full border-2 border-[var(--color-nexus-accent)] border-t-transparent animate-spin" />
  </div>
);

// Page components are memoised so they are NOT unmounted/remounted when the
// parent re-renders due to unrelated store changes.  Without memo, every
// appendStreamStep dispatch re-renders AuthenticatedApp (which subscribes to
// the whole store), which in turn re-renders Workspace, which re-renders the
// entire execution timeline for every single streamed chunk.
const WorkspacePage    = memo(() => <Workspace />);
const WorkflowsPage    = memo(() => <Workflows />);
const DashboardPage    = memo(() => <Dashboard />);
const HistoryPage      = memo(() => <History />);
const TracesPage       = memo(() => <Traces />);
const MemoryPage       = memo(() => <Memory />);
const AgentsPage       = memo(() => <Agents />);
const ObservPage       = memo(() => <Observability />);
const BillingPage      = memo(() => <Billing />);
const SettingsPage     = memo(() => <Settings />);

const PAGES: Record<string, React.ReactNode> = {
  workspace:     <WorkspacePage />,
  workflows:     <WorkflowsPage />,
  dashboard:     <DashboardPage />,
  history:       <HistoryPage />,
  traces:        <TracesPage />,
  memory:        <MemoryPage />,
  agents:        <AgentsPage />,
  observability: <ObservPage />,
  billing:       <BillingPage />,
  settings:      <SettingsPage />,
};

function AuthenticatedApp() {
  // Selector: only re-render when currentPage changes, NOT on every store update.
  const currentPage = useAppStore(s => s.currentPage);
  const completed   = useOnboardingStore(s => s.completed);

  const page = useMemo(() => PAGES[currentPage] ?? <WorkspacePage />, [currentPage]);

  if (!completed) return <Onboarding />;

  return (
    <AppShell>
      <Suspense fallback={<PageFallback />}>
        {page}
      </Suspense>
    </AppShell>
  );
}

export default function App() {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  if (!isAuthenticated) return <Auth />;
  return <AuthenticatedApp />;
}
