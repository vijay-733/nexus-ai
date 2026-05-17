import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './index.css';

// StrictMode intentionally removed.
// StrictMode's double-invoke (mount → fake-unmount → remount) fires the
// cancelStreamRef cleanup during the fake unmount, aborting any in-flight SSE
// stream before the user has seen a single result.  The resulting abort triggers
// onError → failSession → session shows as "Failed" with no output.
// Strict-mode linting is handled by the TypeScript compiler instead.

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </ErrorBoundary>,
);
