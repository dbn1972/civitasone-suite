import { pino } from "pino";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { financeChangeRequests } from "./schema.js";
import { alwaysDistinctApprover, assertDistinctApprover, DomainError, type FinanceSettings, type ChangeRequestKind } from "./domain.js";
import { loadSettingsTx } from "./repo.js";
import { applyFiscalYearActivation, applyOpeningBalances, applyHoaChange, applySettingsChange, auditEvent, type ActorMeta, type OpeningBalanceEntry, type Tx } from "./apply.js";

const log = pino({ name: "finance.approvals.consumer" });

type SubmitPayload = {
  id: string; tenantId: string; kind: ChangeRequestKind; subjectKey: string;
  payload: Record<string, unknown>; reason: string;
};
type DecidePayload = { requestId: string; tenantId: string; decision: "approve" | "reject" | "cancel"; note: string | null };

/** Run the approved change inside the caller's transaction. */
async function applyApproved(
  tx: Tx, meta: ActorMeta, req: { id: string; kind: string; payload: Record<string, unknown>; reason: string },
): Promise<void> {
  const p = req.payload;
  switch (req.kind) {
    case "fiscal_year_activate":
      return applyFiscalYearActivation(tx, meta, { code: String(p.code), reason: req.reason, requestId: req.id });
    case "opening_balances_enter":
      return applyOpeningBalances(tx, meta, {
        id: String(p.id), fyCode: String(p.fyCode), entries: p.entries as OpeningBalanceEntry[], reason: req.reason, requestId: req.id,
      });
    case "hoa_change":
      await applyHoaChange(tx, meta, { headId: String(p.headId), hoaCode: String(p.hoaCode), reason: req.reason, requestId: req.id });
      return;
    case "settings_relax":
      return applySettingsChange(tx, meta, { changes: p.changes as Partial<FinanceSettings>, reason: req.reason, requestId: req.id });
    default:
      throw new NonRetryableError(`[finance/approvals] unknown change request kind ${req.kind}`);
  }
}

export function registerApprovalsConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.changeRequestSubmit, async (msg) => {
    const p = msg.payload as SubmitPayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const inserted = await tx.insert(financeChangeRequests).values({
        id: p.id, tenantId: p.tenantId, kind: p.kind, subjectKey: p.subjectKey, payload: p.payload,
        reason: p.reason, requestedBy: msg.actorId,
      }).onConflictDoNothing().returning({ id: financeChangeRequests.id });
      if (inserted.length === 0) {
        throw new DomainError("CHANGE_REQUEST_PENDING", `a ${p.kind} change for ${p.subjectKey} is already awaiting approval`);
      }
      await auditEvent(tx, msg as ActorMeta, "change_request_submitted", "change_request", p.id, {
        kind: p.kind, subjectKey: p.subjectKey, reason: p.reason,
      });
    });
    log.info({ id: p.id, kind: p.kind }, "change request submitted");
  });

  queue.subscribe(COMMANDS.changeRequestDecide, async (msg) => {
    const p = msg.payload as DecidePayload;
    const meta: ActorMeta = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Row lock: two concurrent decisions on the same request serialise here.
      const [req] = await tx.select().from(financeChangeRequests)
        .where(and(eq(financeChangeRequests.id, p.requestId), eq(financeChangeRequests.tenantId, p.tenantId)))
        .for("update").limit(1);
      if (!req) throw new NonRetryableError(`[finance/approvals] change request ${p.requestId} not found`);
      if (req.status !== "pending") throw new NonRetryableError(`[finance/approvals] change request ${p.requestId} is already ${req.status}`);
      const settings = await loadSettingsTx(tx, p.tenantId);
      // Relaxing a control always needs a distinct approver, even though maker-checker is what may be being switched off.
      const enforce = settings.makerCheckerEnabled || alwaysDistinctApprover(req.kind);

      let finalStatus: "approved" | "rejected" | "cancelled" =
        p.decision === "approve" ? "approved" : p.decision === "reject" ? "rejected" : "cancelled";
      let note = p.note;

      if (p.decision === "cancel") {
        if (req.requestedBy !== msg.actorId) throw new NonRetryableError("[finance/approvals] only the requester can cancel");
      } else {
        try {
          assertDistinctApprover(req.requestedBy, msg.actorId, enforce);
        } catch (err) {
          throw new NonRetryableError(`[finance/approvals] ${(err as Error).message}`);
        }
      }

      if (p.decision === "approve") {
        try {
          await applyApproved(tx, meta, req);
        } catch (err) {
          // A rule that no longer holds (period reopened, duplicate balances...)
          // turns the approval into a recorded rejection rather than a stuck
          // request. Apply functions validate before they write, so nothing
          // partial remains in this transaction.
          if (!(err instanceof DomainError)) throw err;
          finalStatus = "rejected";
          note = `Not applied: ${err.message}`;
          await auditEvent(tx, meta, "change_request_apply_failed", "change_request", req.id, { kind: req.kind, error: err.code });
        }
      }

      // Conditional transition: only a still-pending row, and (when the policy
      // is on) never by its own maker, can move. Zero rows = lost a race.
      const moved = await tx.update(financeChangeRequests).set({
        status: finalStatus, decidedBy: msg.actorId, decidedAt: new Date(), decisionNote: note,
        version: sql`${financeChangeRequests.version} + 1`,
      }).where(and(
        eq(financeChangeRequests.id, req.id), eq(financeChangeRequests.tenantId, p.tenantId),
        eq(financeChangeRequests.status, "pending"),
        p.decision !== "cancel" && enforce ? ne(financeChangeRequests.requestedBy, msg.actorId) : undefined,
      )).returning({ id: financeChangeRequests.id });
      if (moved.length === 0) throw new NonRetryableError(`[finance/approvals] change request ${req.id} was decided concurrently`);

      await auditEvent(tx, meta, `change_request_${finalStatus}`, "change_request", req.id, {
        kind: req.kind, subjectKey: req.subjectKey, requestedBy: req.requestedBy, note,
      });
    });
    await cache.invalidateResource(msg.tenantId, "masters");
    await cache.invalidateResource(msg.tenantId, "accounts");
    log.info({ id: p.requestId, decision: p.decision }, "change request decided");
  });

  queue.subscribe(COMMANDS.financeSettingsUpdate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; changes: Partial<FinanceSettings>; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await applySettingsChange(tx, msg as ActorMeta, { changes: p.changes, reason: p.reason });
    });
  });

  // HoA change applied directly (second-approver setting off): the write happens here, not in the request handler.
  queue.subscribe(COMMANDS.hoaChangeApply, async (msg) => {
    const p = msg.payload as { headId: string; hoaCode: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await applyHoaChange(tx, msg as ActorMeta, { headId: p.headId, hoaCode: p.hoaCode, reason: p.reason });
    });
    await cache.invalidateResource(msg.tenantId, "accounts");
  });
}
