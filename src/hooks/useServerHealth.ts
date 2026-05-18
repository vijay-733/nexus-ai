import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { healthApi } from '../lib/api';

export type ConnectionState = 'connected' | 'degraded' | 'offline' | 'checking' | 'slow';

const SLOW_THRESHOLD_MS = 4000;

export function useServerHealth() {
  const [state, setState] = useState<ConnectionState>('checking');
  const startRef = useRef(Date.now());

  const { data, isError, isFetching } = useQuery({
    queryKey: ['server-health-ping'],
    queryFn: () => healthApi.live(),
    refetchInterval: 15_000,
    retry: 1,
    retryDelay: 2000,
  });

  // If we've been checking for > SLOW_THRESHOLD_MS with no response, surface a 'slow' state
  useEffect(() => {
    if (state !== 'checking') return;
    const timer = setTimeout(() => {
      setState(prev => prev === 'checking' ? 'slow' : prev);
    }, SLOW_THRESHOLD_MS);
    return () => clearTimeout(timer);
  }, []); // only on mount

  useEffect(() => {
    if (isFetching && (state === 'checking' || state === 'slow')) return;
    if (isError)       setState('offline');
    else if (data?.ok) setState('connected');
    else               setState('degraded');
  }, [data, isError, isFetching]);

  return state;
}
