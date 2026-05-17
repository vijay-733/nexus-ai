import { randomUUID } from 'crypto';
import { globalEventBus } from '../events/eventBus.js';
import type { PlanId } from './plans.js';
import { getPlan, CREDIT_COSTS } from './plans.js';

export interface UserAccount {
  userId: string;
  planId: PlanId;
  credits: number;
  creditsUsedThisMonth: number;
  resetAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  type: 'credit' | 'debit' | 'reset' | 'purchase';
  amount: number;
  balance: number;
  action?: string;
  description: string;
  createdAt: number;
}

const emit = globalEventBus.createEmitter('credits-system');

export class CreditsSystem {
  private accounts     = new Map<string, UserAccount>();
  private transactions = new Map<string, CreditTransaction[]>();

  createAccount(userId: string, planId: PlanId = 'free'): UserAccount {
    const plan = getPlan(planId);
    const now  = Date.now();
    const acct: UserAccount = {
      userId,
      planId,
      credits:              plan.monthlyCredits,
      creditsUsedThisMonth: 0,
      resetAt:              this.nextReset(),
      createdAt:            now,
      updatedAt:            now,
    };
    this.accounts.set(userId, acct);
    this.transactions.set(userId, []);
    return acct;
  }

  getAccount(userId: string): UserAccount | null {
    return this.accounts.get(userId) ?? null;
  }

  getOrCreate(userId: string): UserAccount {
    return this.getAccount(userId) ?? this.createAccount(userId, 'free');
  }

  deduct(
    userId: string,
    action: string,
    overrideAmount?: number
  ): { success: boolean; reason?: string; balance: number } {
    const acct = this.getOrCreate(userId);
    if (Date.now() > acct.resetAt) this.resetMonthly(userId);

    const amount = overrideAmount ?? CREDIT_COSTS[action] ?? 1;
    if (acct.credits < amount) {
      return {
        success: false,
        reason:  `Insufficient credits (have ${acct.credits}, need ${amount})`,
        balance: acct.credits,
      };
    }

    acct.credits              -= amount;
    acct.creditsUsedThisMonth += amount;
    acct.updatedAt             = Date.now();

    this.record(userId, {
      type:        'debit',
      amount,
      balance:     acct.credits,
      action,
      description: `Used ${amount} credit${amount !== 1 ? 's' : ''} for ${action}`,
    });

    emit('MEMORY_WRITTEN', { userId, action, amount, balance: acct.credits }, { userId });
    return { success: true, balance: acct.credits };
  }

  credit(userId: string, amount: number, description: string): UserAccount {
    const acct    = this.getOrCreate(userId);
    acct.credits += amount;
    acct.updatedAt = Date.now();
    this.record(userId, { type: 'credit', amount, balance: acct.credits, description });
    return acct;
  }

  upgradePlan(userId: string, newPlanId: PlanId): UserAccount {
    const acct    = this.getOrCreate(userId);
    const oldPlan = getPlan(acct.planId);
    const newPlan = getPlan(newPlanId);
    const bonus   = newPlan.monthlyCredits - oldPlan.monthlyCredits;
    if (bonus > 0) acct.credits += bonus;
    acct.planId    = newPlanId;
    acct.updatedAt = Date.now();
    this.record(userId, {
      type:        'credit',
      amount:      Math.max(0, bonus),
      balance:     acct.credits,
      description: `Upgraded to ${newPlan.name} plan`,
    });
    return acct;
  }

  getTransactions(userId: string, limit = 50): CreditTransaction[] {
    return (this.transactions.get(userId) ?? []).slice(-limit).reverse();
  }

  allAccounts(): UserAccount[] {
    return [...this.accounts.values()];
  }

  private resetMonthly(userId: string): void {
    const acct = this.accounts.get(userId);
    if (!acct) return;
    const plan               = getPlan(acct.planId);
    acct.credits             = plan.monthlyCredits;
    acct.creditsUsedThisMonth = 0;
    acct.resetAt             = this.nextReset();
    acct.updatedAt           = Date.now();
    this.record(userId, {
      type:        'reset',
      amount:      plan.monthlyCredits,
      balance:     plan.monthlyCredits,
      description: 'Monthly credit reset',
    });
  }

  private record(
    userId: string,
    data: Omit<CreditTransaction, 'id' | 'userId' | 'createdAt'>
  ): void {
    const txns = this.transactions.get(userId) ?? [];
    txns.push({ ...data, id: randomUUID(), userId, createdAt: Date.now() });
    if (txns.length > 500) txns.shift();
    this.transactions.set(userId, txns);
  }

  private nextReset(): number {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
}

export const creditsSystem = new CreditsSystem();
