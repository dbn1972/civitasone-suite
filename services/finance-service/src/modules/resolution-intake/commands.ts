/**
 * Resolution Sanction Intake — write commands (maker-checker review).
 *
 * The review transition (accept/reject) records the officer's decision on the
 * intake item. Accepting does NOT auto-post a sanction/voucher — see the hook
 * comment below; a competent officer proceeds via the normal sanction flow
 * (POST /v1/finance/sanctions), preserving GFR authorization / maker-checker.
 */
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { financeResolutionSanctionIntake as t } from "./schema.js";
import type { RequestContext } from "@civitasone/types";

const AUDIT_TOPIC = "audit.event.record";

export async function reviewIntake(
  ctx: RequestContext,
  id: string,
  decision: "accepted" | "rejected",
  note: string | undefined,
): Promise<{ id: string; status: string } | null> {
  const now = new Date();

  return db.transaction(async (tx) => {
    // Only a pending item can be reviewed (idempotent + maker-checker gate).
    const updated = await tx
      .update(t)
      .set({
        status: decision,
        reviewedBy: ctx.actorId,
        reviewedAt: now,
        note: note ?? null,
        updatedAt: now,
        version: sql`${t.version} + 1`,
      })
      .where(and(eq(t.id, id), eq(t.tenantId, ctx.tenantId), eq(t.status, "pending_review")))
      .returning({ id: t.id, status: t.status });

    if (updated.length === 0) return null;

    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId ?? id,
      payload: {
        service: "finance",
        action: decision === "accepted" ? "resolution_sanction_intake_accepted" : "resolution_sanction_intake_rejected",
        resourceType: "finance_resolution_sanction_intake",
        resourceId: id,
        outcome: "success",
        metadata: { decision, note: note ?? null },
      },
    });

    // ── CHOREOGRAPHY HOOK (intentionally NOT auto-executing) ──────────────────
    // On "accepted" the intake is merely marked reviewed/accepted. We deliberately
    // do NOT create a real sanction here: GFR maker-checker requires a competent
    // officer to raise it through the controlled flow (POST /v1/finance/sanctions),
    // which carries its own authorization + eOffice approval chain. If a future
    // requirement wants a pre-filled draft, invoke the sanction create-command here
    // with status "draft" (still human-approved), never a posted sanction.

    return updated[0]!;
  });
}
