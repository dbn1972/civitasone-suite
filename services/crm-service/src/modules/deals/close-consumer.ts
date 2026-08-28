/**
 * Deal close consumer (OP-006) — applies `crm.deal.close` and `crm.deal_close_policy.set`.
 *
 * won/lost pin stage Won/Lost, status won/lost, probability 100/0 and stamp closed_at.
 * cancelled/on_hold do NOT move the stage — they record the closure via close_outcome so
 * a parked/cancelled opportunity is distinguishable in reporting without pretending it
 * was won or lost. The mandatory reason and (for losses) the competitor are persisted.
 *
 * The write is the authority on "already closed": the guard requires close_outcome IS
 * NULL and stage NOT IN (Won,Lost), so a duplicate or racing close leaves the first
 * outcome intact.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { invalidateDashboard } from "../dashboard/queries.js";
import * as repo from "./repo.js";
import { deriveStageFields } from "./stage-gate.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-deal-close-consumer" });
const RESOURCE = "deal";

interface ClosePayload {
  dealId: string;
  outcome: "won" | "lost" | "cancelled" | "on_hold";
  reason: string;
  closedValue: string | null;
  competitor: string[] | null;
}

export function registerDealCloseConsumer(queue: Queue): void {
  queue.subscribe(COMMANDS.setDealClosePolicy, async (msg) => {
    const p = msg.payload as { tenantId: string; competitorRequiredOnLoss: boolean };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.deal_close_policy (tenant_id, competitor_required_on_loss, updated_by)
          VALUES (${p.tenantId}, ${p.competitorRequiredOnLoss}, ${msg.actorId})
          ON CONFLICT (tenant_id) DO UPDATE
            SET competitor_required_on_loss = EXCLUDED.competitor_required_on_loss,
                updated_at = now(), updated_by = EXCLUDED.updated_by
        `);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.dealClosePolicySet,
          action: "set_close_policy",
          resourceType: "deal_close_policy",
          resourceId: p.tenantId,
          payload: { competitorRequiredOnLoss: p.competitorRequiredOnLoss },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "setDealClosePolicy failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.closeDeal, async (msg) => {
    const p = msg.payload as ClosePayload;
    const stage = p.outcome === "won" ? "Won" : p.outcome === "lost" ? "Lost" : null;
    // won/lost/on_hold map straight to status. A 'cancelled' CLOSURE must NOT reuse the
    // soft-delete marker ('cancelled'), or every read-path filter (NOT IN
    // ('deleted','cancelled')) would hide a legitimately cancelled-and-reportable deal.
    // It is stored as status='closed' with close_outcome='cancelled' so it stays visible
    // in GET/list/funnel while genuine soft-deletes remain hidden.
    const status = p.outcome === "cancelled" ? "closed" : p.outcome;
    // OP-003/gate-integrity: probability + closed_at for won/lost come from the SAME
    // single source of truth every stage-change path uses (stage-gate.ts's
    // deriveStageFields), not a re-implemented 100/0 mapping — Won/Lost still force
    // 100/0 regardless of any pipeline config, exactly as the PATCH /stage path does.
    // cancelled/on_hold never move `stage` at all, so they stay outside
    // deriveStageFields entirely (`derived` is null for those two outcomes).
    const derived = stage ? deriveStageFields(stage, undefined) : null;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // stage_id must move in lockstep with `stage`, resolved by NAME through the
        // SAME repo.resolveTargetStage the PATCH /stage write path uses (repo.ts's
        // updateStageWithVersion) — never left pointing at whatever stage preceded the
        // close. cancelled/on_hold don't move `stage` (see comment above), so — like
        // stageSet below — they don't touch stage_id either. Looked up here rather than
        // trusting any caller-supplied value: this consumer's payload doesn't carry a
        // stageId at all, precisely so there is nothing raw to accidentally persist.
        let targetStageId: string | null = null;
        if (stage !== null) {
          const dealRows = (await tx.execute(sql`
            SELECT pipeline_id AS "pipelineId" FROM crm.deals
            WHERE id = ${p.dealId} AND tenant_id = ${msg.tenantId}
          `)) as unknown as Array<{ pipelineId: string | null }>;
          const targetStageConfig = await repo.resolveTargetStage(tx, dealRows[0]?.pipelineId ?? null, msg.tenantId, stage);
          targetStageId = targetStageConfig?.id ?? null;
        }

        const stageSet = stage !== null ? sql`stage = ${stage}, stage_id = ${targetStageId}::uuid,` : sql``;
        const probSet = derived ? sql`probability = ${derived.probability},` : sql``;
        const closedAtSet = derived?.closesDeal ? sql`closed_at = now(),` : sql``;
        const competitorJson = p.competitor == null ? null : JSON.stringify(p.competitor);

        const rows = (await tx.execute(sql`
          UPDATE crm.deals
          SET ${stageSet}
              status = ${status},
              ${probSet}
              ${closedAtSet}
              close_outcome = ${p.outcome},
              close_reason = ${p.reason === "" ? null : p.reason},
              close_competitor = ${competitorJson}::jsonb,
              closed_value_minor = COALESCE(${p.closedValue}::bigint, value_minor),
              updated_at = now(),
              updated_by = ${msg.actorId},
              version = version + 1
          WHERE id = ${p.dealId}
            AND tenant_id = ${msg.tenantId}
            AND close_outcome IS NULL
            AND stage NOT IN ('Won', 'Lost')
            AND status NOT IN ('deleted', 'cancelled')
          RETURNING closed_value_minor AS "closedValueMinor"
        `)) as unknown as Array<{ closedValueMinor: string }>;

        const row = rows[0];
        if (!row) {
          await emitWithAudit(tx, ctxOf(msg), {
            eventType: EVENTS.dealClosed,
            action: "close",
            resourceType: RESOURCE,
            resourceId: p.dealId,
            payload: { dealId: p.dealId, rejected: true },
            outcome: "rejected_already_closed_or_missing",
          });
          return;
        }

        const accountId = p.outcome === "won" ? await repo.findAccountId(tx, p.dealId, msg.tenantId) : null;

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.dealClosed,
          action: "close",
          resourceType: RESOURCE,
          resourceId: p.dealId,
          payload: {
            dealId: p.dealId,
            outcome: p.outcome,
            stage,
            accountId,
            closedValueMinor: String(row.closedValueMinor),
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "closeDeal failed");
      throw err;
    }

    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.dealId));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
    await invalidateDashboard(msg.tenantId);
  });
}

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  } as Parameters<typeof emitWithAudit>[1];
}
