/**
 * G7 Quota guard — invoked in the send path BEFORE dispatching to check the
 * tenant has not exhausted their channel quota for the current period.
 *
 * If quota is exhausted → reject with CHANNEL_QUOTA_EXHAUSTED.
 * If no quota row exists for the period → allow (quotas are opt-in).
 * If status is 'unlimited' → always allow.
 */
import * as quotaRepo from "./quota-repo.js";
import type { db } from "../../shared/db.js";

export interface QuotaCheckResult {
  passed: boolean;
  used?: bigint;
  limit?: bigint;
}

/**
 * Check whether the tenant's channel quota allows one more send.
 * Returns { passed: true } if allowed (or no quota configured or unlimited),
 * { passed: false } if exhausted.
 *
 * Takes the caller's ALREADY-OPEN transaction (`processSend`'s outer send
 * transaction) and reads through it directly instead of opening a second,
 * nested transaction. Opening a second transaction here (the previous
 * `quotaRepo.findCurrentQuota`, which uses `scopedRead`) acquired a SECOND
 * connection from the same pool as the outer send -- with `pool.max = 10`,
 * once 10 sends were concurrently in-flight the pool was exhausted and
 * every one of them deadlocked waiting on its own nested quota check.
 */
export async function checkQuota(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
  channel: string,
): Promise<QuotaCheckResult> {
  const today = new Date().toISOString().slice(0, 10);
  const quota = await quotaRepo.findCurrentQuotaInTx(tx, tenantId, channel, today);

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
