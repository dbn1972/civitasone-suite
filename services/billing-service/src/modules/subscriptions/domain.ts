export const TRIAL_DAYS = 30;

export function trialExpiresAt(startedAt: Date): Date {
  const d = new Date(startedAt);
  d.setDate(d.getDate() + TRIAL_DAYS);
  return d;
}

export type SubscriptionView = {
  id: string;
  tenantId: string;
  planId: string;
  status: string;
  trialExpiresAt?: string;
};
