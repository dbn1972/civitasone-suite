import { NonRetryableError, type Queue } from "@civitasone/queue";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { auditEvent, type Tx } from "../approvals/apply.js";
import { loadSettingsTx } from "../approvals/repo.js";
import { financeUC } from "./schema.js";
import * as ucRepo from "./uc-repo.js";
import { assertUCWithinSanction } from "./uc-domain.js";

type Msg = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: unknown };

/**
 * One conditional transition per command. The WHERE clause names the expected
 * current status (and, when the second-approver setting is on, excludes the
 * maker), so two concurrent decisions on the same UC cannot both succeed.
 */
async function transition(
  msg: Msg, action: string,
  build: (enforce: boolean) => { from: string; set: Record<string, unknown>; checker: boolean },
  details: (p: Record<string, unknown>) => Record<string, unknown>,
  guard?: (tx: Tx, uc: typeof financeUC.$inferSelect) => Promise<void>,
): Promise<void> {
  const p = msg.payload as { id: string; tenantId: string };
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const settings = await loadSettingsTx(tx, p.tenantId);
    const enforce = settings.makerCheckerEnabled;
    const { from, set, checker } = build(enforce);
    if (guard) {
      const [uc] = await tx.select().from(financeUC).where(and(eq(financeUC.id, p.id), eq(financeUC.tenantId, p.tenantId))).limit(1);
      if (!uc) throw new NonRetryableError(`[finance/payments] UC_NOT_FOUND: ${p.id}`);
      await guard(tx, uc);
    }
    const moved = await tx.update(financeUC).set({ ...set, updatedBy: msg.actorId, updatedAt: new Date() })
      .where(and(
        eq(financeUC.id, p.id), eq(financeUC.tenantId, p.tenantId), eq(financeUC.status, from),
        checker && enforce ? ne(financeUC.createdBy, msg.actorId) : undefined,
      )).returning({ id: financeUC.id });
    if (moved.length === 0) {
      throw new NonRetryableError(`[finance/payments] UC_TRANSITION_REFUSED: ${action} on ${p.id} (not ${from}, not found, or maker deciding own certificate)`);
    }
    await auditEvent(tx, msg as never, action, "utilization_certificate", p.id, details(p));
  });
  await cache.invalidateResource(msg.tenantId, "uc");
}

export function registerUCLifecycleConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.ucVerify, (msg) => transition(msg as Msg, "verify_uc",
    () => ({ from: "submitted", checker: true, set: { status: "verified", decidedBy: msg.actorId, decidedAt: new Date(), rejectionReason: null } }),
    () => ({})));

  queue.subscribe(COMMANDS.ucReject, (msg) => transition(msg as Msg, "reject_uc",
    () => ({
      from: "submitted", checker: true,
      set: { status: "rejected", decidedBy: msg.actorId, decidedAt: new Date(), rejectionReason: (msg.payload as { reason: string }).reason },
    }),
    (p) => ({ reason: p.reason })));

  queue.subscribe(COMMANDS.ucResubmit, (msg) => transition(msg as Msg, "resubmit_uc",
    () => ({
      from: "rejected", checker: false,
      set: {
        status: "submitted", submittedDate: new Date().toISOString().slice(0, 10),
        resubmitCount: sql`${financeUC.resubmitCount} + 1`,
      },
    }),
    (p) => ({ note: p.note ?? null }),
    // A returned UC does not count against the sanction, so another UC may have used the headroom meanwhile:
    // coming back must fit again (sanction locked, same rule as creation).
    async (tx, uc) => {
      if (!uc.grantRef) return;
      const sanction = await ucRepo.findApprovedSanctionByNo(tx, uc.tenantId, uc.grantRef, true);
      if (!sanction) return;
      assertUCWithinSanction(sanction.amountMinor, await ucRepo.sumClaimedForGrantRef(tx, uc.tenantId, uc.grantRef, uc.id), uc.amountMinor);
    }));
}
