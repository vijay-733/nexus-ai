import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { healthApi } from '../lib/api';

export type ConnectionState = 'connected' | 'degraded' | 'offline' | 'checking';

export function useServerHealth() {
  const [state, setState] = useState<ConnectionState>('checking');

  const { data, isError, isFetching } = useQuery({
    queryKey: ['server-health-ping'],
    queryFn: () => healthApi.live(),
    refetchInterval: 15_000,
    retry: 1,
    retryDelay: 2000,
  });

  useEffect(() => {
    if (isFetching && state === 'checking') return;
    if (isError)       setState('offline');
    else if (data?.ok) setState('connected');
    else               setState('degraded');
  }, [data, isError, isFetching]);

  return state;
}
