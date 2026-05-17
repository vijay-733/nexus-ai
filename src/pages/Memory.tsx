import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Brain, Search, Trash2, RefreshCw, Database } from 'lucide-react';
import { memoryApi } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { SkeletonCard } from '../components/ui/Skeleton';
import { cn } from '../lib/utils';

export default function Memory() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [ns, setNs] = useState('');

  const { data: memory, isLoading } = useQuery({
    queryKey: ['memory', ns],
    queryFn: () => memoryApi.list(ns || undefined),
    refetchInterval: 30_000,
  });

  const clearMutation = useMutation({
    mutationFn: () => Promise.all(
      (memory?.records ?? []).map(r => memoryApi.delete(r.namespace, r.key))
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memory'] }),
  });

  const records = (memory?.records ?? []).filter(r =>
    !search || r.key?.toLowerCase().includes(search.toLowerCase()) ||
    JSON.stringify(r.value).toLowerCase().includes(search.toLowerCase())
  );

  const namespaces = [...new Set((memory?.records ?? []).map(r => r.namespace).filter(Boolean))];

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Agent Memory</h2>
          <p className="text-sm text-[var(--color-text-muted)]">{records.length} records</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ['memory'] })}
          >
            <RefreshCw size={13} />
            Refresh
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={clearMutation.isPending}
            onClick={() => clearMutation.mutate()}
          >
            <Trash2 size={13} />
            Clear All
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search memory..."
            className="w-full h-9 pl-9 pr-3 rounded-lg text-sm bg-[var(--color-nexus-elevated)] border border-[var(--color-nexus-border)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-nexus-accent)] focus:outline-none"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setNs('')}
            className={cn(
              'text-xs px-2.5 py-1 rounded-lg border transition-colors',
              ns === '' ? 'bg-[var(--color-nexus-accent-3)] border-[rgba(0,229,160,0.2)] text-[var(--color-nexus-accent)]'
                       : 'border-[var(--color-nexus-border)] text-[var(--color-text-muted)]'
            )}
          >
            all
          </button>
          {namespaces.map(n => (
            <button
              key={n}
              onClick={() => setNs(n ?? '')}
              className={cn(
                'text-xs px-2.5 py-1 rounded-lg border transition-colors',
                ns === n ? 'bg-[var(--color-nexus-accent-3)] border-[rgba(0,229,160,0.2)] text-[var(--color-nexus-accent)]'
                         : 'border-[var(--color-nexus-border)] text-[var(--color-text-muted)]'
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Records */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Database size={32} className="text-[var(--color-text-muted)] mb-3" />
          <p className="text-sm text-[var(--color-text-muted)]">No memory records found</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">Memory is created when agents run tasks</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {records.map((record, i) => (
            <motion.div
              key={record.id ?? i}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="surface rounded-xl p-4 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {record.namespace && <Badge variant="purple" size="sm">{record.namespace}</Badge>}
                    <span className="text-xs font-mono text-[var(--color-text-secondary)] truncate">
                      {record.key}
                    </span>
                  </div>
                </div>
                {record.updatedAt && (
                  <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                    {new Date(record.updatedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="bg-[var(--color-nexus-void)] rounded-lg p-3 border border-[var(--color-nexus-border)]">
                <pre className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap break-words line-clamp-4 font-mono">
                  {typeof record.value === 'string' ? record.value : JSON.stringify(record.value, null, 2)}
                </pre>
              </div>
              {record.tags && record.tags.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {record.tags.map(tag => (
                    <Badge key={tag} variant="outline" size="sm">{tag}</Badge>
                  ))}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
