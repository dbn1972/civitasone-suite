/**
 * GAP-PAYROLL-STATUTORY-PT-04: consumer that writes a new PT slab version.
 *
 * One transaction: markProcessed -> per-(tenant,state) advisory lock -> the
 * guards are RE-CHECKED against the database (the route's pre-check can be
 * stale) -> header + slab rows -> audit.event.record outbox event. Two
 * concurrent creations for the same state are serialised by the lock, so the
 * loser sees the winner's row and is rejected (audited as a failure) instead
 * of racing past the checks. Past versions are never touched (and the 0077
 * triggers refuse it anyway).
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { checkNewVersion, todayIst, type CreatePtVersionBody } from "./pt-versions-domain.js";
import { latestFinalisedRunMonth } from "./pt-versions-repo.js";

const AUDIT = "audit.event.record";

type Msg = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: unknown };

export function registerPtVersionConsumers(queue: Pick<Queue, "subscribe">): void {
  queue.subscribe(COMMANDS.ptVersionCreate, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as CreatePtVersionBody & { tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Serialise version creation per (tenant, state) for the rest of this transaction.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pt-version:${p.tenantId}:${p.stateCode}`}, 0))`);

      const existing = (await tx.execute(sql`
        SELECT DISTINCT effective_from::text AS effective_from
          FROM payroll.payroll_professional_tax
         WHERE tenant_id = ${p.tenantId}::uuid AND state_code = ${p.stateCode} AND is_active = true
      `)) as unknown as Array<{ effective_from: string }>;
      const verdict = checkNewVersion({
        effectiveFrom: p.effectiveFrom, today: todayIst(),
        latestFinalisedMonth: await latestFinalisedRunMonth(tx as unknown as typeof db, p.tenantId),
        existingEffectiveFroms: existing.map((e) => e.effective_from),
        reason: p.reason,
      });
      const resourceId = `${p.stateCode}:${p.effectiveFrom}`;
      const audit = (action: string, outcome: string, details: Record<string, unknown>) => enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { ...details, service: "payroll", action, resourceType: "payroll_pt_slab_version", resourceId, outcome },
      });
      if (!verdict.ok) {
        // Lost a race (or the facts changed since the route's check): nothing is written.
        await audit("create_rejected", "failure", { code: verdict.failure.code, reason: p.reason ?? null });
        return;
      }

      await tx.execute(sql`
        INSERT INTO payroll.payroll_pt_slab_versions
          (tenant_id, state_code, effective_from, reason, source, back_dated, created_by)
        VALUES (${p.tenantId}::uuid, ${p.stateCode}, ${p.effectiveFrom}::date, ${p.reason ?? null}, 'user',
                ${verdict.backDated}, ${msg.actorId}::uuid)
      `);
      for (const s of p.slabs) {
        await tx.execute(sql`
          INSERT INTO payroll.payroll_professional_tax
            (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor, february_amount_minor, effective_from, is_active)
          VALUES (${p.tenantId}::uuid, ${p.stateCode}, ${s.fromMinor.toString()}::bigint, ${s.toMinor.toString()}::bigint,
                  ${s.taxMinor.toString()}::bigint, ${s.februaryTaxMinor == null ? null : s.februaryTaxMinor.toString()}::bigint,
                  ${p.effectiveFrom}::date, true)
        `);
      }
      await enqueue(tx, {
        topic: EVENTS.ptVersionCreated, eventType: EVENTS.ptVersionCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { stateCode: p.stateCode, effectiveFrom: p.effectiveFrom, slabCount: p.slabs.length, backDated: verdict.backDated },
      });
      await audit("create", "success", {
        effectiveFrom: p.effectiveFrom, slabCount: p.slabs.length, backDated: verdict.backDated, reason: p.reason ?? null,
      });
    });
  });
}
