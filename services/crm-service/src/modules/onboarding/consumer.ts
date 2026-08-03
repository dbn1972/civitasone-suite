/**
 * Onboarding consumers (P1-9).
 *
 * Two jobs:
 *  - open a case when a deal reaches Won. The trigger is the deal-won EVENT relayed
 *    from the outbox, not a call into the deals module: onboarding never reads a deal
 *    row and holds `dealId` only as an opaque reference, so the module stays
 *    independently extractable.
 *  - apply stage and KYC commands, each guarded so a command that was legal when the
 *    route accepted it cannot apply against state that has since moved on.
 *
 * The KYC gate is repeated here on purpose. The route already refuses a premature
 * completion, but its read is a snapshot: between the 202 and the write, KYC could be
 * re-opened. `AND (:toStage <> 'completed' OR kyc_status = 'verified')` makes the
 * database the authority, and a rejected apply leaves an audit record rather than
 * disappearing.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { INITIAL_KYC_STATUS, INITIAL_STAGE } from "./domain.js";
import { invalidateCase, RESOURCE } from "./queries.js";
import { cache } from "../../shared/infra.js";

const log = pino({ name: "crm-onboarding-consumer" });

type CtxLike = Parameters<typeof emitWithAudit>[1];

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }): CtxLike {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  } as CtxLike;
}

interface DealWonEvent {
  dealId: string;
  accountId?: string | null;
  /** Present on crm.deal.closed. */
  outcome?: string;
  /** Present on crm.deal.stage_updated. */
  newStage?: string;
}

interface AdvanceStagePayload {
  id: string;
  tenantId: string;
  toStage: string;
  fromStage: string;
  cancellationReason: string | null;
  version: number;
}

interface RecordKycPayload {
  id: string;
  tenantId: string;
  toStatus: string;
  fromStatus: string;
  reference: string | null;
  version: number;
}

/** A deal is Won either through the close command (OP-006) or a plain stage move. */
function reachedWon(p: DealWonEvent): boolean {
  return p.outcome === "won" || p.newStage === "Won";
}

async function openCase(msg: CommandEnvelope, p: DealWonEvent): Promise<void> {
  let openedId: string | null = null;
  try {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const id = randomUUID();
      // ON CONFLICT against the (tenant_id, deal_id) unique index: a deal that is
      // closed-won and separately stage-moved to Won produces two distinct events,
      // and both must converge on one case.
      const rows = (await tx.execute(sql`
        INSERT INTO crm.onboarding_cases
          (id, tenant_id, deal_id, account_id, stage, kyc_status, created_by, updated_by)
        VALUES (
          ${id}, ${msg.tenantId}, ${p.dealId}, ${p.accountId ?? null},
          ${INITIAL_STAGE}, ${INITIAL_KYC_STATUS}, ${msg.actorId}, ${msg.actorId}
        )
        ON CONFLICT (tenant_id, deal_id) DO NOTHING
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      if (rows.length === 0) return;
      openedId = id;
      await emitWithAudit(tx, ctxOf(msg), {
        eventType: EVENTS.onboardingCaseOpened,
        action: "open",
        resourceType: RESOURCE,
        resourceId: id,
        payload: {
          caseId: id,
          dealId: p.dealId,
          accountId: p.accountId ?? null,
          stage: INITIAL_STAGE,
          kycStatus: INITIAL_KYC_STATUS,
        },
      });
    });
  } catch (err) {
    log.error({ err, messageId: msg.messageId }, "openOnboardingCase failed");
    throw err;
  }
  if (openedId) await invalidateCase(msg.tenantId, openedId);
  else await cache.invalidateResource(msg.tenantId, RESOURCE);
}

export function registerOnboardingConsumers(queue: Queue): void {
  const onDealWon = async (msg: CommandEnvelope): Promise<void> => {
    const p = msg.payload as DealWonEvent;
    if (!reachedWon(p) || !p.dealId) return;
    await openCase(msg, p);
  };

  queue.subscribe(EVENTS.dealClosed, onDealWon);
  queue.subscribe(EVENTS.dealStageUpdated, onDealWon);

  queue.subscribe(COMMANDS.advanceOnboardingStage, async (msg) => {
    const p = msg.payload as AdvanceStagePayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = (await tx.execute(sql`
          UPDATE crm.onboarding_cases
          SET stage = ${p.toStage},
              completed_at = CASE WHEN ${p.toStage}::text = 'completed' THEN now() ELSE completed_at END,
              cancellation_reason = COALESCE(${p.cancellationReason}, cancellation_reason),
              updated_at = now(),
              updated_by = ${msg.actorId},
              version = version + 1
          WHERE id = ${p.id}
            AND tenant_id = ${p.tenantId}
            AND version = ${p.version}
            AND stage = ${p.fromStage}
            AND (${p.toStage}::text <> 'completed' OR kyc_status = 'verified')
          RETURNING id
        `)) as unknown as Array<{ id: string }>;

        if (rows.length === 0) {
          await emitWithAudit(tx, ctxOf(msg), {
            eventType: EVENTS.onboardingStageAdvanced,
            action: "advance_stage",
            resourceType: RESOURCE,
            resourceId: p.id,
            payload: { caseId: p.id, toStage: p.toStage, rejected: true },
            outcome: await rejectionOutcome(tx, p),
          });
          return;
        }

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.onboardingStageAdvanced,
          action: "advance_stage",
          resourceType: RESOURCE,
          resourceId: p.id,
          payload: { caseId: p.id, fromStage: p.fromStage, toStage: p.toStage },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "advanceOnboardingStage failed");
      throw err;
    }
    await invalidateCase(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.recordOnboardingKyc, async (msg) => {
    const p = msg.payload as RecordKycPayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = (await tx.execute(sql`
          UPDATE crm.onboarding_cases
          SET kyc_status = ${p.toStatus},
              kyc_reference = COALESCE(${p.reference}, kyc_reference),
              kyc_verified_at = CASE WHEN ${p.toStatus}::text = 'verified' THEN now() ELSE kyc_verified_at END,
              updated_at = now(),
              updated_by = ${msg.actorId},
              version = version + 1
          WHERE id = ${p.id}
            AND tenant_id = ${p.tenantId}
            AND version = ${p.version}
            AND kyc_status = ${p.fromStatus}
          RETURNING id
        `)) as unknown as Array<{ id: string }>;

        if (rows.length === 0) {
          await emitWithAudit(tx, ctxOf(msg), {
            eventType: EVENTS.onboardingKycRecorded,
            action: "record_kyc",
            resourceType: RESOURCE,
            resourceId: p.id,
            payload: { caseId: p.id, toStatus: p.toStatus, rejected: true },
            outcome: "rejected_stale_state",
          });
          return;
        }

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.onboardingKycRecorded,
          action: "record_kyc",
          resourceType: RESOURCE,
          resourceId: p.id,
          // The provider reference is deliberately not echoed into the event stream.
          payload: { caseId: p.id, fromStatus: p.fromStatus, toStatus: p.toStatus },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "recordOnboardingKyc failed");
      throw err;
    }
    await invalidateCase(msg.tenantId, p.id);
  });
}

/**
 * Why a guarded stage UPDATE matched nothing. Worth the extra read: "the write was
 * dropped" and "the write was dropped because KYC is not verified" are very different
 * lines to find in an audit trail six months later.
 */
async function rejectionOutcome(
  tx: Parameters<typeof emitWithAudit>[0],
  p: AdvanceStagePayload,
): Promise<string> {
  const rows = (await (tx as { execute: (q: unknown) => Promise<unknown> }).execute(sql`
    SELECT stage, kyc_status AS "kycStatus", version
    FROM crm.onboarding_cases
    WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
  `)) as unknown as Array<{ stage: string; kycStatus: string; version: number }>;
  const row = rows[0];
  if (!row) return "rejected_not_found";
  if (p.toStage === "completed" && row.kycStatus !== "verified") return "rejected_kyc_not_verified";
  return "rejected_stale_state";
}
