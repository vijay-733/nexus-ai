import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { CreditCard, Zap, Crown, Rocket, Building2, CheckCircle2, TrendingUp, RefreshCw } from 'lucide-react';
import { billingApi } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useAppStore } from '../store/appStore';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { toast } from '../store/toastStore';

const PLANS = [
  {
    id: 'free',       name: 'Free',       icon: Zap,       price: '$0/mo',    credits: 100,    color: 'default' as const,
    features: ['100 credits/month', 'ReAct + Multi agent modes', 'Basic memory', '5 req/min'],
  },
  {
    id: 'pro',        name: 'Pro',        icon: Crown,     price: '$29/mo',   credits: 5000,   color: 'accent' as const,
    features: ['5,000 credits/month', 'All agent modes', 'Full memory + compression', '60 req/min', 'Priority queue', 'Trace history'],
    popular: true,
  },
  {
    id: 'team',       name: 'Team',       icon: Rocket,    price: '$99/mo',   credits: 25000,  color: 'blue' as const,
    features: ['25,000 credits/month', 'Unlimited modes', 'Team memory namespaces', '300 req/min', 'Dedicated queue', 'SLA 99.9%'],
  },
  {
    id: 'enterprise', name: 'Enterprise', icon: Building2, price: 'Custom',   credits: -1,     color: 'purple' as const,
    features: ['Unlimited credits', 'Private cloud deployment', 'Custom SLA + support', 'SAML SSO', 'Audit logs', 'On-prem option'],
  },
];

export default function Billing() {
  const qc = useQueryClient();
  const { user, setUser } = useAuthStore();
  const { sessionHistory } = useAppStore();

  const { data: account, isLoading } = useQuery({
    queryKey: ['billing-account'],
    queryFn: () => billingApi.account(),
    retry: 1,
  });

  const upgradeMutation = useMutation({
    mutationFn: (planId: string) => billingApi.upgrade(planId),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['billing-account'] });
      if (data?.account && user) {
        setUser({ ...user, plan: data.account.planId, credits: data.account.credits });
      }
      toast.success('Plan upgraded successfully');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const totalTokens = sessionHistory.reduce((a, s) => a + (s.result?.tokens ?? 0), 0);
  const totalSessions = sessionHistory.length;
  const usedCredits  = account?.creditsUsed ?? 0;
  const totalCredits = account?.credits ?? (user?.credits ?? 0) + usedCredits;
  const usagePct     = totalCredits > 0 ? Math.min((usedCredits / totalCredits) * 100, 100) : 0;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Billing & Usage</h2>
          <p className="text-sm text-[var(--color-text-muted)]">Manage subscription, credits, and usage</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['billing-account'] })} className="gap-1.5">
          <RefreshCw size={13} />
          Refresh
        </Button>
      </div>

      {/* Account overview */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-5 flex-wrap">
            <div className="flex items-center gap-4 flex-1 min-w-[200px]">
              <div className="w-12 h-12 rounded-xl bg-[var(--color-nexus-accent-3)] border border-[rgba(0,229,160,0.2)] flex items-center justify-center">
                <Crown size={20} className="text-[var(--color-nexus-accent)]" />
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">Current plan</p>
                {isLoading
                  ? <Skeleton className="h-6 w-20 mt-1" />
                  : <p className="text-lg font-bold text-[var(--color-text-primary)] capitalize">{account?.plan ?? user?.plan ?? 'Free'}</p>
                }
              </div>
            </div>

            <div className="flex items-center gap-8">
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">Credits remaining</p>
                {isLoading
                  ? <Skeleton className="h-8 w-16 mt-1" />
                  : <p className="text-2xl font-bold text-[var(--color-nexus-accent)]">{(user?.credits ?? account?.credits ?? 0).toLocaleString()}</p>
                }
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">Used</p>
                {isLoading
                  ? <Skeleton className="h-8 w-16 mt-1" />
                  : <p className="text-2xl font-bold text-[var(--color-text-primary)]">{usedCredits.toLocaleString()}</p>
                }
              </div>
            </div>
          </div>

          {/* Usage bar */}
          {!isLoading && totalCredits > 0 && (
            <div className="mt-5 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
                <span>Credit usage</span>
                <span>{usagePct.toFixed(0)}% used</span>
              </div>
              <div className="h-2 bg-[var(--color-nexus-elevated)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${usagePct}%`,
                    backgroundColor: usagePct > 80 ? 'var(--color-nexus-red)' : usagePct > 60 ? 'var(--color-nexus-amber)' : 'var(--color-nexus-accent)',
                  }}
                />
              </div>
            </div>
          )}

          {/* Usage stats */}
          <div className="mt-4 pt-4 border-t border-[var(--color-nexus-border)] grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Sessions</p>
              <p className="text-lg font-bold text-[var(--color-text-primary)]">{totalSessions}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Tokens used</p>
              <p className="text-lg font-bold text-[var(--color-text-primary)]">{totalTokens.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Est. cost</p>
              <p className="text-lg font-bold text-[var(--color-text-primary)]">${(totalTokens * 0.000002).toFixed(4)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Plans */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">Plans</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan, i) => {
            const Icon = plan.icon;
            const isCurrent = (user?.plan ?? 'free') === plan.id;
            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className={`surface rounded-xl p-5 space-y-4 relative flex flex-col ${plan.popular ? 'border-[var(--color-nexus-accent)]' : ''}`}
              >
                {plan.popular && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                    <Badge variant="accent" size="sm">Most popular</Badge>
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={15} className="text-[var(--color-nexus-accent)]" />
                    <span className="text-sm font-bold text-[var(--color-text-primary)]">{plan.name}</span>
                  </div>
                  <p className="text-xl font-bold gradient-text">{plan.price}</p>
                </div>

                <ul className="space-y-2 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
                      <CheckCircle2 size={11} className="text-[var(--color-nexus-green)] mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Button
                  variant={isCurrent ? 'ghost' : plan.popular ? 'primary' : 'secondary'}
                  size="sm"
                  className="w-full"
                  disabled={isCurrent || upgradeMutation.isPending}
                  loading={upgradeMutation.isPending}
                  onClick={() => !isCurrent && plan.id !== 'enterprise' && upgradeMutation.mutate(plan.id)}
                >
                  {isCurrent ? 'Current plan' : plan.id === 'enterprise' ? 'Contact sales' : 'Upgrade'}
                </Button>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Recent transactions */}
      {account?.transactions && account.transactions.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Recent Transactions</h3>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-[var(--color-nexus-border)]">
              {account.transactions.slice(0, 8).map(tx => (
                <div key={tx.id} className="flex items-center gap-4 px-5 py-3">
                  <span className="text-xs font-mono text-[var(--color-text-muted)] shrink-0 w-24 truncate">{tx.id.slice(0, 8)}</span>
                  <span className="text-xs text-[var(--color-text-secondary)] flex-1">{tx.action}</span>
                  <span className={`text-xs font-mono shrink-0 ${tx.amount > 0 ? 'text-[var(--color-nexus-green)]' : 'text-[var(--color-nexus-red)]'}`}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                    {new Date(tx.timestamp).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
