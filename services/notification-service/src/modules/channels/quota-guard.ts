/**
 * G7 Quota guard — invoked in the send path BEFORE dispatching to check the
 * tenant has not exhausted their channel quota for the current period.
 *
 * If quota is exhausted → reject with CHANNEL_QUOTA_EXHAUSTED.
 * If no quota row exists for the period → allow (quotas are opt-in).
 * If status is 'unlimited' → always allow.
 */
import * as quotaRepo from "./quota-repo.js";

export interface QuotaCheckResult {
  passed: boolean;
  used?: bigint;
  limit?: bigint;
}

/**
 * Check whether the tenant's channel quota allows one more send.
 * Returns { passed: true } if allowed (or no quota configured or unlimited),
 * { passed: false } if exhausted.
 */
export async function checkQuota(
  tenantId: string,
  channel: string,
): Promise<QuotaCheckResult> {
  const today = new Date().toISOString().slice(0, 10);
  const quota = await quotaRepo.findCurrentQuota(tenantId, channel, today);

  // No quota configured for this period — allow
  if (!quota) return { passed: true };

  // Unlimited status — always allow
  if (quota.status === "unlimited") {
    return { passed: true, used: quota.used, limit: quota.monthlyLimit };
  }

  if (quota.used >= quota.monthlyLimit) {
    return { passed: false, used: quota.used, limit: quota.monthlyLimit };
  }

  return { passed: true, used: quota.used, limit: quota.monthlyLimit };
}
