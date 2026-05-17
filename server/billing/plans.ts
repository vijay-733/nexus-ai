export type PlanId = 'free' | 'pro' | 'enterprise';

export interface Plan {
  id: PlanId;
  name: string;
  monthlyCredits: number;
  rateLimit: { requestsPerMinute: number; requestsPerHour: number; requestsPerDay: number };
  features: string[];
  maxConcurrentAgents: number;
  maxWorkflowNodes: number;
  allowedModels: string[];
  allowedTools: string[];
  canUseAdvancedModels: boolean;
  canUseVectorDB: boolean;
  canCreateCustomAgents: boolean;
  pricePerMonth: number;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id:             'free',
    name:           'Free',
    monthlyCredits: 100,
    pricePerMonth:  0,
    rateLimit:      { requestsPerMinute: 5, requestsPerHour: 50, requestsPerDay: 200 },
    features:       ['text-generation', 'basic-agents'],
    maxConcurrentAgents:   2,
    maxWorkflowNodes:      5,
    allowedModels:         ['pollinations'],
    allowedTools:          ['text'],
    canUseAdvancedModels:  false,
    canUseVectorDB:        false,
    canCreateCustomAgents: false,
  },
  pro: {
    id:             'pro',
    name:           'Pro',
    monthlyCredits: 5_000,
    pricePerMonth:  29,
    rateLimit:      { requestsPerMinute: 30, requestsPerHour: 500, requestsPerDay: 5_000 },
    features:       ['text-generation', 'image-generation', 'advanced-agents', 'multi-agent', 'workflow'],
    maxConcurrentAgents:   10,
    maxWorkflowNodes:      50,
    allowedModels:         ['openai', 'anthropic', 'pollinations'],
    allowedTools:          ['text', 'image', 'research', 'memory'],
    canUseAdvancedModels:  true,
    canUseVectorDB:        false,
    canCreateCustomAgents: true,
  },
  enterprise: {
    id:             'enterprise',
    name:           'Enterprise',
    monthlyCredits: 100_000,
    pricePerMonth:  299,
    rateLimit:      { requestsPerMinute: 200, requestsPerHour: 5_000, requestsPerDay: 100_000 },
    features: [
      'text-generation', 'image-generation', 'advanced-agents', 'multi-agent', 'workflow',
      'vector-db', 'custom-models', 'audit-logs', 'sso', 'priority-support',
    ],
    maxConcurrentAgents:   100,
    maxWorkflowNodes:      500,
    allowedModels:         ['openai', 'anthropic', 'pollinations', 'custom'],
    allowedTools:          ['text', 'image', 'research', 'memory', 'code', 'browser'],
    canUseAdvancedModels:  true,
    canUseVectorDB:        true,
    canCreateCustomAgents: true,
  },
};

export const CREDIT_COSTS: Record<string, number> = {
  'text-generation':          1,
  'text-generation-advanced': 5,
  'image-generation':         10,
  'image-generation-hd':      25,
  'agent-run':                2,
  'agent-run-advanced':       10,
  'research-task':            3,
  'workflow-run':             5,
  'memory-search':            1,
};

export function getPlan(planId: string): Plan {
  return PLANS[planId as PlanId] ?? PLANS.free;
}
