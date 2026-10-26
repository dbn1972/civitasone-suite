/**
 * Owner decision #42 — daily contract-expiry sweeper.
 *
 * Finds ACTIVE contracts whose expiry falls exactly on a milestone
 * (EXPIRY_MILESTONES days away) across ALL tenants and publishes one
 * contract.expiry.check command per contract. The consumer (consumer.ts)
 * re-validates inside a transaction and emits contract.expiry.alert.
 *
 * The cross-tenant scan cannot use `db` (contracts.contract_contracts is FORCE
 * RLS and contract_svc is NOBYPASSRLS: a bare select with no app.tenant_id GUC
 * returns zero rows forever). It calls the narrow SECURITY DEFINER function
 * contracts.sweep_expiring_contracts() owned by contract_scanner (migration
 * 0023) — same shape as citizen-service's sla-sweep.
 */
import type { Queue } from "@civitasone/queue";
import { sqlClient } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import { EXPIRY_MILESTONES, SYSTEM_ACTOR_ID, expiryMessageId, isMilestone } from "./domain.js";

type Log = { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };

const SWEEP_ENABLED = (process.env.CONTRACT_EXPIRY_SWEEP_ENABLED ?? "true") !== "false";
// Several ticks a day so one missed tick (restart/outage) cannot skip a milestone;
// same-day repeats dedupe on the deterministic messageId.
const SWEEP_INTERVAL_MS = Number(process.env.CONTRACT_EXPIRY_SWEEP_INTERVAL_MS ?? 6 * 60 * 60 * 1000);

interface ExpiringRow { id: string; tenant_id: string; expiry: string; days_remaining: number }

/** One sweep pass. Returns the number of check commands published. */
export async function runExpirySweep(queue: Queue, log?: Log): Promise<number> {
  const horizon = Math.max(...EXPIRY_MILESTONES);
  const rows = await sqlClient<ExpiringRow[]>`
    select id, tenant_id, to_char(expiry, 'YYYY-MM-DD') as expiry, days_remaining
    from contracts.sweep_expiring_contracts(${horizon}::int)
  `;
  let n = 0;
  for (const r of rows) {
    const days = Number(r.days_remaining);
    if (!isMilestone(days)) continue;
    const messageId = expiryMessageId(r.id, r.expiry, days);
    try {
      await queue.publish(COMMANDS.contractExpiryCheck, {
        messageId,
        type: COMMANDS.contractExpiryCheck,
        tenantId: r.tenant_id,
        actorId: SYSTEM_ACTOR_ID,
        correlationId: messageId,
        schemaVersion: "1.0",
        payload: { contractId: r.id, expiry: r.expiry, milestoneDays: days },
      });
      n++;
    } catch (err) {
      // One bad publish must not abort the rest of the sweep.
      log?.error({ err, contractId: r.id }, "contract expiry check publish failed");
    }
  }
  log?.info({ scanned: rows.length, published: n }, "contract expiry sweep tick complete");
  return n;
}

/** Start the periodic sweep. Returns the interval handle (clear on shutdown). */
export function startExpirySweep(queue: Queue, log?: Log): NodeJS.Timeout | null {
  if (!SWEEP_ENABLED) {
    log?.info({}, "contract expiry sweep disabled (CONTRACT_EXPIRY_SWEEP_ENABLED=false)");
    return null;
  }
  const tick = (): void => {
    void runExpirySweep(queue, log).catch((err) => log?.error({ err }, "contract expiry sweep failed"));
  };
  setTimeout(tick, 15_000);
  const handle = setInterval(tick, SWEEP_INTERVAL_MS);
  log?.info({ intervalMs: SWEEP_INTERVAL_MS }, "contract expiry sweep scheduler started");
  return handle;
}
