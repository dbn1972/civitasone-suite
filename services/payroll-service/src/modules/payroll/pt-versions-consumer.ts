/**
 * GAP-PAYROLL-STATUTORY-PT-04: consumers for professional-tax slab versions,
 * with maker != checker.
 *
 * A PT slab version changes every employee's deduction, so by default (the
 * tenant setting payroll_settings.pt_version_maker_checker, DEFAULT ON) a new
 * version is only a PENDING request that a DIFFERENT payroll_admin /
 * super_admin approves. Turning that setting OFF is itself a pending request
 * that needs a second approver; turning it back ON takes effect at once.
 *
 * Every consumer is one transaction: markProcessed -> per-(tenant,state)
 * advisory lock -> guards re-checked against the database (a route pre-check
 * can be stale, and the rules are re-run at approval time because the world
 * may have moved since the request) -> write -> audit.event.record outbox
 * event. The approval is a CONDITIONAL UPDATE (status still pending AND the
 * decider is not the maker), so two concurrent decisions change one row once.
 * Turning the switch back ON also CANCELS a still-pending "turn it off" request
 * (audited), so a later approval cannot switch it off. Turning it OFF leaves
 * requests that are already pending PENDING: they still need their approver.
 * Past versions are never touched (the 0077 triggers refuse it anyway).
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { checkNewVersion, todayIst, type CreatePtVersionBody } from "./pt-versions-domain.js";
import { latestFinalisedRunMonth } from "./pt-versions-repo.js";

const AUDIT = "audit.event.record";
const log = pino({ name: "payroll-pt-versions" });

type Msg = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: unknown };
type Tx = Parameters<typeof enqueue>[0];
type Slabs = CreatePtVersionBody["slabs"];

async function exec<T = Record<string, unknown>>(tx: Tx, q: ReturnType<typeof sql>): Promise<T[]> {
  return (await (tx as unknown as { execute: (x: unknown) => Promise<unknown> }).execute(q)) as T[];
}

const audit = (tx: Tx, msg: Msg, action: string, resourceId: string, outcome: string, details: Record<string, unknown>) =>
  enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { ...details, service: "payroll", action, resourceType: "payroll_pt_slab_version", resourceId, outcome },
  });

/** Serialise PT changes per (tenant, state) for the rest of the transaction. */
const lock = (tx: Tx, tenantId: string, scope: string) =>
  exec(tx, sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pt-version:${tenantId}:${scope}`}, 0))`);

/** The tenant's maker-checker switch (DEFAULT ON; no settings row is ON too). */
async function makerCheckerOn(tx: Tx, tenantId: string): Promise<boolean> {
  const rows = await exec<{ enabled: boolean }>(tx, sql`
    SELECT pt_version_maker_checker AS enabled FROM payroll.payroll_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1`);
  return rows[0]?.enabled ?? true;
}

/** The rules a version must satisfy RIGHT NOW (creation and, again, approval). */
async function verdictFor(tx: Tx, tenantId: string, stateCode: string, effectiveFrom: string, reason: string | undefined) {
  // Every date already taken: the header table AND any slab rows (a header-less
  // legacy / inactive row still occupies its (tenant, state, effective_from) key).
  const existing = await exec<{ effective_from: string }>(tx, sql`
    SELECT effective_from::text AS effective_from FROM payroll.payroll_pt_slab_versions
     WHERE tenant_id = ${tenantId}::uuid AND state_code = ${stateCode}
    UNION
    SELECT effective_from::text FROM payroll.payroll_professional_tax
     WHERE tenant_id = ${tenantId}::uuid AND state_code = ${stateCode}`);
  return checkNewVersion({
    effectiveFrom, today: todayIst(),
    latestFinalisedMonth: await latestFinalisedRunMonth(tx as unknown as typeof db, tenantId),
    existingEffectiveFroms: existing.map((e) => e.effective_from),
    reason,
  });
}

async function writeVersion(
  tx: Tx, msg: Msg,
  v: { tenantId: string; stateCode: string; effectiveFrom: string; slabs: Slabs; reason: string | undefined; backDated: boolean; makerId: string; approverId: string | null },
): Promise<void> {
  await exec(tx, sql`
    INSERT INTO payroll.payroll_pt_slab_versions
      (tenant_id, state_code, effective_from, reason, source, back_dated, created_by, approved_by)
    VALUES (${v.tenantId}::uuid, ${v.stateCode}, ${v.effectiveFrom}::date, ${v.reason ?? null}, 'user',
            ${v.backDated}, ${v.makerId}::uuid, ${v.approverId}::uuid)`);
  for (const s of v.slabs) {
    await exec(tx, sql`
      INSERT INTO payroll.payroll_professional_tax
        (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor, february_amount_minor, applies_to_gender, effective_from, is_active)
      VALUES (${v.tenantId}::uuid, ${v.stateCode}, ${s.fromMinor.toString()}::bigint, ${s.toMinor.toString()}::bigint,
              ${s.taxMinor.toString()}::bigint, ${s.februaryTaxMinor == null ? null : s.februaryTaxMinor.toString()}::bigint,
              ${s.appliesToGender ?? "all"},
              ${v.effectiveFrom}::date, true)`);
  }
  await enqueue(tx, {
    topic: EVENTS.ptVersionCreated, eventType: EVENTS.ptVersionCreated,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { stateCode: v.stateCode, effectiveFrom: v.effectiveFrom, slabCount: v.slabs.length, backDated: v.backDated },
  });
}

export function registerPtVersionConsumers(queue: Pick<Queue, "subscribe">): void {
  // ─── a maker proposes a new version ─────────────────────────────────────
  queue.subscribe(COMMANDS.ptVersionCreate, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as CreatePtVersionBody & { tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lock(tx, p.tenantId, p.stateCode);
      const resourceId = `${p.stateCode}:${p.effectiveFrom}`;
      const record = (status: string, code: string | null) => exec(tx, sql`
        INSERT INTO payroll.payroll_pt_version_requests (id, tenant_id, kind, state_code, effective_from, payload, status, code, maker_id)
        VALUES (${msg.messageId}::uuid, ${p.tenantId}::uuid, 'version', ${p.stateCode}, ${p.effectiveFrom}::date,
                ${JSON.stringify({ slabs: p.slabs, reason: p.reason ?? null })}::jsonb, ${status}, ${code}, ${msg.actorId}::uuid)
        ON CONFLICT (id) DO NOTHING`);

      const verdict = await verdictFor(tx, p.tenantId, p.stateCode, p.effectiveFrom, p.reason);
      if (!verdict.ok) {
        // Lost a race (or the facts changed since the route's check): nothing is written,
        // but the outcome is recorded so the UI can tell the user instead of saying "saved".
        await record("rejected", verdict.failure.code);
        await audit(tx, msg, "create_rejected", resourceId, "failure", { code: verdict.failure.code, reason: p.reason ?? null });
        return;
      }
      if (await makerCheckerOn(tx, p.tenantId)) {
        await record("pending_approval", null);
        await audit(tx, msg, "submit", resourceId, "success", {
          effectiveFrom: p.effectiveFrom, slabCount: p.slabs.length, backDated: verdict.backDated, reason: p.reason ?? null,
        });
        return;
      }
      await writeVersion(tx, msg, {
        tenantId: p.tenantId, stateCode: p.stateCode, effectiveFrom: p.effectiveFrom, slabs: p.slabs, reason: p.reason,
        backDated: verdict.backDated, makerId: msg.actorId, approverId: null,
      });
      await record("applied", null);
      await audit(tx, msg, "create", resourceId, "success", {
        effectiveFrom: p.effectiveFrom, slabCount: p.slabs.length, backDated: verdict.backDated, reason: p.reason ?? null, makerChecker: false,
      });
    });
  });

  // ─── a DIFFERENT administrator approves or rejects a pending request ────
  queue.subscribe(COMMANDS.ptVersionDecide, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as { tenantId: string; id: string; decision: "approved" | "rejected"; note: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const head = await exec<{ state_code: string | null }>(tx, sql`
        SELECT state_code FROM payroll.payroll_pt_version_requests WHERE id = ${p.id}::uuid AND tenant_id = ${p.tenantId}::uuid`);
      if (!head[0]) { log.warn({ id: p.id }, "PT request decision for an unknown request"); return; }
      await lock(tx, p.tenantId, head[0].state_code ?? "*");

      // Race-safe: only a request that is STILL pending and whose maker is somebody
      // else transitions; a concurrent decision or a self-approval updates nothing.
      const rows = await exec<{ kind: string; state_code: string | null; effective_from: string | null; payload: { slabs?: Slabs; reason?: string | null }; maker_id: string }>(tx, sql`
        UPDATE payroll.payroll_pt_version_requests
           SET status = ${p.decision === "approved" ? "applied" : "declined"}, decided_by = ${msg.actorId}::uuid,
               decided_at = NOW(), decision_note = ${p.note}, updated_at = NOW()
         WHERE id = ${p.id}::uuid AND tenant_id = ${p.tenantId}::uuid
           AND status = 'pending_approval' AND maker_id IS DISTINCT FROM ${msg.actorId}::uuid
     RETURNING kind, state_code, effective_from::text AS effective_from, payload, maker_id::text AS maker_id`);
      const r = rows[0];
      if (!r) {
        log.warn({ id: p.id, decision: p.decision }, "PT decision was a no-op (not pending, or decided by its maker)");
        await audit(tx, msg, "decision_ignored", p.id, "failure", { decision: p.decision });
        return;
      }
      const resourceId = r.kind === "version" ? `${r.state_code}:${r.effective_from}` : p.id;
      if (p.decision === "rejected") {
        await audit(tx, msg, "reject", resourceId, "success", { requestId: p.id, kind: r.kind, ...(p.note ? { reason: p.note } : {}), makerId: r.maker_id });
        return;
      }

      if (r.kind === "checker_off") {
        await exec(tx, sql`
          INSERT INTO payroll.payroll_settings (tenant_id, pt_version_maker_checker, created_at, updated_at)
          VALUES (${p.tenantId}::uuid, FALSE, NOW(), NOW())
          ON CONFLICT (tenant_id) DO UPDATE SET pt_version_maker_checker = FALSE, updated_at = NOW()`);
        await audit(tx, msg, "approve", resourceId, "success", {
          requestId: p.id, kind: r.kind, makerId: r.maker_id, ...(p.note ? { reason: p.note } : {}),
          before: { ptVersionMakerChecker: true }, after: { ptVersionMakerChecker: false },
        });
        return;
      }

      // Re-run the rules NOW: another version may have taken the date, a run may have
      // been finalised past it, or a future date may have become back-dated meanwhile.
      const slabs = r.payload.slabs ?? [];
      const reason = r.payload.reason ?? undefined;
      const verdict = await verdictFor(tx, p.tenantId, r.state_code!, r.effective_from!, reason);
      if (!verdict.ok) {
        await exec(tx, sql`
          UPDATE payroll.payroll_pt_version_requests SET status = 'rejected', code = ${verdict.failure.code}, updated_at = NOW()
           WHERE id = ${p.id}::uuid AND tenant_id = ${p.tenantId}::uuid`);
        await audit(tx, msg, "approve_rejected", resourceId, "failure", { requestId: p.id, code: verdict.failure.code, makerId: r.maker_id });
        return;
      }
      await writeVersion(tx, msg, {
        tenantId: p.tenantId, stateCode: r.state_code!, effectiveFrom: r.effective_from!, slabs, reason,
        backDated: verdict.backDated, makerId: r.maker_id, approverId: msg.actorId,
      });
      await audit(tx, msg, "approve", resourceId, "success", {
        requestId: p.id, kind: r.kind, makerId: r.maker_id, slabCount: slabs.length, backDated: verdict.backDated,
        ...(p.note ? { note: p.note } : {}), ...(reason ? { reason } : {}),
      });
    });
  });

  // ─── the maker-checker switch itself ────────────────────────────────────
  // ON takes effect at once (the safe direction); OFF is a pending request that
  // a DIFFERENT administrator must approve.
  queue.subscribe(COMMANDS.ptCheckerSet, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as { tenantId: string; enabled: boolean; reason: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lock(tx, p.tenantId, "*");
      const current = await makerCheckerOn(tx, p.tenantId);
      if (p.enabled) {
        // Withdraw a pending "turn it off" request, so approving it later cannot switch the requirement off.
        const cancelled = await exec<{ id: string }>(tx, sql`
          UPDATE payroll.payroll_pt_version_requests
             SET status = 'cancelled', decided_by = ${msg.actorId}::uuid, decided_at = NOW(), decision_note = 'Switch turned back on', updated_at = NOW()
           WHERE tenant_id = ${p.tenantId}::uuid AND kind = 'checker_off' AND status = 'pending_approval'
       RETURNING id::text AS id`);
        for (const c of cancelled) {
          await audit(tx, msg, "setting_off_cancelled", p.tenantId, "success", { requestId: c.id });
        }
        if (current) return;
        await exec(tx, sql`
          INSERT INTO payroll.payroll_settings (tenant_id, pt_version_maker_checker, created_at, updated_at)
          VALUES (${p.tenantId}::uuid, TRUE, NOW(), NOW())
          ON CONFLICT (tenant_id) DO UPDATE SET pt_version_maker_checker = TRUE, updated_at = NOW()`);
        await audit(tx, msg, "setting_on", p.tenantId, "success", { before: { ptVersionMakerChecker: false }, after: { ptVersionMakerChecker: true } });
        return;
      }
      if (!current) return;
      const inserted = await exec(tx, sql`
        INSERT INTO payroll.payroll_pt_version_requests (id, tenant_id, kind, payload, status, maker_id)
        VALUES (${msg.messageId}::uuid, ${p.tenantId}::uuid, 'checker_off', ${JSON.stringify({ reason: p.reason })}::jsonb, 'pending_approval', ${msg.actorId}::uuid)
        ON CONFLICT DO NOTHING RETURNING id`);
      if (inserted.length === 0) return; // one pending "turn off" request at a time
      await audit(tx, msg, "setting_off_requested", p.tenantId, "success", { requestId: msg.messageId, ...(p.reason ? { reason: p.reason } : {}) });
    });
  });
}
