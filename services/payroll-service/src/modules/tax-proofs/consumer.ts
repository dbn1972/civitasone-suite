/**
 * GAP-PAYROLL-TAX-DECLARATION-02: consumers for investment-proof commands.
 * Every consumer writes in ONE tenant-scoped transaction together with an
 * `audit.event.record` outbox event, and every state transition is a
 * conditional UPDATE so a concurrent duplicate decides nothing twice.
 */
import { sql } from "drizzle-orm";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { deleteObject } from "@civitasone/storage";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { DEFAULT_RETENTION_YEARS, MAX_PROOFS_PER_LINE } from "./domain.js";
import { DEFAULT_PROOF_CUTOFF_MD } from "../tax/verified-inputs.js";

const log = pino({ name: "payroll-tax-proofs-consumer" });
const AUDIT = "audit.event.record";
const PURGE_BATCH = 200;

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => Array.from(r as Iterable<Row>);

interface Msg {
  messageId: string;
  tenantId: string;
  actorId: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function audit(tx: any, msg: Pick<Msg, "tenantId" | "actorId" | "correlationId">, action: string, resourceId: string, details: Record<string, unknown>): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT,
    eventType: AUDIT,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "payroll", action, resourceType: "payroll_tax_proof", resourceId, outcome: "success", details },
  });
}

export interface PurgeResult { purged: number; skipped: number; failed: number }

/**
 * Purge one tenant's due proofs: the object first, then the row, then the
 * audit event -- per row, in one transaction that holds the row lock so a
 * legal hold placed concurrently either lands first (row skipped) or finds the
 * row gone. Idempotent: deleting an already-absent object succeeds, and a
 * crash between object delete and row delete is finished by the next run.
 * Never purges anything under legal hold.
 */
export async function purgeTenantProofs(
  msg: Pick<Msg, "tenantId" | "actorId" | "correlationId">,
  opts: { now?: Date; limit?: number; removeObject?: (key: string) => Promise<void> } = {},
): Promise<PurgeResult> {
  const now = opts.now ?? new Date();
  const removeObject = opts.removeObject ?? deleteObject;
  const result: PurgeResult = { purged: 0, skipped: 0, failed: 0 };

  const { years, candidates } = await db.transaction(async (tx) => {
    const s = rowsOf(await tx.execute(sql`
      SELECT tax_proof_retention_years AS years FROM payroll.payroll_settings WHERE tenant_id = ${msg.tenantId}::uuid
    `))[0];
    const yrs = s ? Number(s.years) : DEFAULT_RETENTION_YEARS;
    const cands = rowsOf(await tx.execute(sql`
      SELECT id::text AS id FROM payroll.tax_proofs
       WHERE tenant_id = ${msg.tenantId}::uuid AND legal_hold = false
         AND (status = 'removed'
              OR make_date(substr(fy, 1, 4)::int + 1 + ${yrs}::int, 3, 31) < (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')::date)
       ORDER BY created_at, id
       LIMIT ${opts.limit ?? PURGE_BATCH}
    `));
    return { years: yrs, candidates: cands.map((c) => String(c.id)) };
  });

  for (const id of candidates) {
    try {
      const done = await db.transaction(async (tx) => {
        // Re-check under a row lock: state may have changed since the scan.
        const row = rowsOf(await tx.execute(sql`
          SELECT storage_key, fy, line, status, employee_id::text AS employee_id FROM payroll.tax_proofs
           WHERE id = ${id}::uuid AND tenant_id = ${msg.tenantId}::uuid AND legal_hold = false
             AND (status = 'removed'
                  OR make_date(substr(fy, 1, 4)::int + 1 + ${years}::int, 3, 31) < (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')::date)
           FOR UPDATE
        `))[0];
        if (!row) return false;
        await removeObject(String(row.storage_key)); // throws -> tx rolls back, row stays
        await tx.execute(sql`DELETE FROM payroll.tax_proofs WHERE id = ${id}::uuid AND tenant_id = ${msg.tenantId}::uuid`);
        await audit(tx, msg, "purge", id, {
          fy: row.fy, line: row.line, employeeId: row.employee_id, previousStatus: row.status,
          retentionYears: years, reason: row.status === "removed" ? "withdrawn_by_employee" : "retention_elapsed",
        });
        return true;
      });
      if (done) result.purged += 1; else result.skipped += 1;
    } catch (err) {
      result.failed += 1;
      log.warn({ err, proofId: id }, "tax proof purge failed for one proof; it stays and is retried next run");
    }
  }
  return result;
}

export function registerTaxProofConsumers(queue: Queue): void {
  // ── submit: attach a verified-uploaded file to a declaration line ─────────
  queue.subscribe(COMMANDS.taxProofSubmit, async (raw) => {
    const msg = raw as unknown as Msg;
    const p = msg.payload as {
      id: string; employeeId: string; fy: string; line: string; storageKey: string; filename: string;
      contentType: string; sizeBytes: number; amountMinor?: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Serialise concurrent submits for the same line so the per-line cap holds.
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`${msg.tenantId}|${p.employeeId}|${p.fy}|${p.line}`}, 0))
      `);
      const count = Number(rowsOf(await tx.execute(sql`
        SELECT count(*)::int AS n FROM payroll.tax_proofs
         WHERE tenant_id = ${msg.tenantId}::uuid AND employee_id = ${p.employeeId}::uuid
           AND fy = ${p.fy} AND line = ${p.line} AND status <> 'removed'
      `))[0]?.n ?? 0);
      if (count >= MAX_PROOFS_PER_LINE) {
        log.warn({ tenantId: msg.tenantId, employeeId: p.employeeId, fy: p.fy, line: p.line }, "tax proof line is full; submit ignored");
        return;
      }
      const inserted = rowsOf(await tx.execute(sql`
        INSERT INTO payroll.tax_proofs
          (id, tenant_id, employee_id, fy, line, storage_key, filename, content_type, size_bytes, amount_minor, status, uploaded_by)
        VALUES (${p.id}::uuid, ${msg.tenantId}::uuid, ${p.employeeId}::uuid, ${p.fy}, ${p.line}, ${p.storageKey}, ${p.filename},
                ${p.contentType}, ${p.sizeBytes}, ${p.amountMinor === undefined ? null : String(p.amountMinor)}::bigint, 'pending', ${msg.actorId}::uuid)
        ON CONFLICT (storage_key) DO NOTHING
        RETURNING id
      `));
      if (inserted.length === 0) return;
      await audit(tx, msg, "upload", p.id, { fy: p.fy, line: p.line, employeeId: p.employeeId, contentType: p.contentType, sizeBytes: p.sizeBytes });
    });
  });

  // ── decide: accept / reject (maker != checker, race-safe) ────────────────
  queue.subscribe(COMMANDS.taxProofDecide, async (raw) => {
    const msg = raw as unknown as Msg;
    const p = msg.payload as { id: string; decision: "accepted" | "rejected"; reason?: string; amountMinor?: number; deciderEmployeeId: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = rowsOf(await tx.execute(sql`
        SELECT amount_minor::text AS amount_minor FROM payroll.tax_proofs
         WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid
      `))[0];
      // The single conditional UPDATE is the decision: only a still-pending proof,
      // never the employee's own (by employee id or by uploader), can be decided.
      const updated = rowsOf(await tx.execute(sql`
        UPDATE payroll.tax_proofs
           SET status = ${p.decision},
               rejection_reason = ${p.decision === "rejected" ? (p.reason ?? null) : null},
               amount_minor = COALESCE(${p.amountMinor === undefined ? null : String(p.amountMinor)}::bigint, amount_minor),
               decided_by = ${msg.actorId}::uuid,
               decided_at = now()
         WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid
           AND status = 'pending'
           -- an accepted proof must carry a verified amount (its own or the officer's)
           AND (${p.decision}::text <> 'accepted' OR amount_minor IS NOT NULL OR ${p.amountMinor === undefined ? null : String(p.amountMinor)}::bigint IS NOT NULL)
           AND uploaded_by <> ${msg.actorId}::uuid
           AND (${p.deciderEmployeeId}::uuid IS NULL OR employee_id <> ${p.deciderEmployeeId}::uuid)
        RETURNING fy, line, employee_id::text AS employee_id, amount_minor::text AS amount_minor
      `));
      const r = updated[0];
      if (!r) {
        log.info({ proofId: p.id, tenantId: msg.tenantId }, "tax proof decision ignored: not pending, or decider is the proof owner");
        return;
      }
      await audit(tx, msg, p.decision === "accepted" ? "accept" : "reject", p.id, {
        fy: r.fy, line: r.line, employeeId: r.employee_id, decision: p.decision, reason: p.reason ?? null,
        amountBeforeMinor: before?.amount_minor ?? null, amountAfterMinor: r.amount_minor ?? null,
      });
    });
  });

  // ── remove: the employee withdraws a still-pending proof ──────────────────
  queue.subscribe(COMMANDS.taxProofRemove, async (raw) => {
    const msg = raw as unknown as Msg;
    const p = msg.payload as { id: string; ownEmployeeId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const r = rowsOf(await tx.execute(sql`
        UPDATE payroll.tax_proofs SET status = 'removed', removed_at = now()
         WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid
           AND employee_id = ${p.ownEmployeeId}::uuid AND status = 'pending' AND legal_hold = false
        RETURNING fy, line
      `))[0];
      if (!r) return;
      await audit(tx, msg, "remove", p.id, { fy: r.fy, line: r.line, employeeId: p.ownEmployeeId });
    });
  });

  // ── legal hold ────────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.taxProofHold, async (raw) => {
    const msg = raw as unknown as Msg;
    const p = msg.payload as { id: string; hold: boolean; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = rowsOf(await tx.execute(sql`
        SELECT legal_hold FROM payroll.tax_proofs
         WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid FOR UPDATE
      `))[0];
      if (!before) return;
      const r = rowsOf(await tx.execute(sql`
        UPDATE payroll.tax_proofs
           SET legal_hold = ${p.hold},
               legal_hold_reason = ${p.hold ? p.reason : null},
               legal_hold_by = ${p.hold ? msg.actorId : null}::uuid,
               legal_hold_at = ${p.hold ? sql`now()` : sql`NULL`}
         WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid AND legal_hold IS DISTINCT FROM ${p.hold}
        RETURNING fy, line, employee_id::text AS employee_id
      `))[0];
      if (!r) return;
      await audit(tx, msg, p.hold ? "legal_hold_set" : "legal_hold_release", p.id, {
        fy: r.fy, line: r.line, employeeId: r.employee_id, before: { legalHold: before.legal_hold }, after: { legalHold: p.hold }, reason: p.reason,
      });
    });
  });

  // ── tenant retention period ───────────────────────────────────────────────
  queue.subscribe(COMMANDS.taxProofRetentionSet, async (raw) => {
    const msg = raw as unknown as Msg;
    const p = msg.payload as { years: number; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = rowsOf(await tx.execute(sql`
        SELECT tax_proof_retention_years AS years FROM payroll.payroll_settings WHERE tenant_id = ${msg.tenantId}::uuid FOR UPDATE
      `))[0];
      const beforeYears = before ? Number(before.years) : DEFAULT_RETENTION_YEARS;
      await tx.execute(sql`
        INSERT INTO payroll.payroll_settings (tenant_id, tax_proof_retention_years)
        VALUES (${msg.tenantId}::uuid, ${p.years})
        ON CONFLICT (tenant_id) DO UPDATE SET tax_proof_retention_years = EXCLUDED.tax_proof_retention_years, updated_at = now()
      `);
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "payroll", action: "retention_update", resourceType: "payroll_tax_proof_settings", resourceId: msg.tenantId,
          outcome: "success", details: { before: { taxProofRetentionYears: beforeYears }, after: { taxProofRetentionYears: p.years }, reason: p.reason ?? null },
        },
      });
    });
  });

  // ── proof-submission cutoff (MM-DD) ───────────────────────────────────────
  queue.subscribe(COMMANDS.taxProofCutoffSet, async (raw) => {
    const msg = raw as unknown as Msg;
    const p = msg.payload as { md: string; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = rowsOf(await tx.execute(sql`
        SELECT tax_proof_cutoff_md AS md FROM payroll.payroll_settings WHERE tenant_id = ${msg.tenantId}::uuid FOR UPDATE
      `))[0];
      const beforeMd = before ? String(before.md) : DEFAULT_PROOF_CUTOFF_MD;
      await tx.execute(sql`
        INSERT INTO payroll.payroll_settings (tenant_id, tax_proof_cutoff_md)
        VALUES (${msg.tenantId}::uuid, ${p.md})
        ON CONFLICT (tenant_id) DO UPDATE SET tax_proof_cutoff_md = EXCLUDED.tax_proof_cutoff_md, updated_at = now()
      `);
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "payroll", action: "cutoff_update", resourceType: "payroll_tax_proof_settings", resourceId: msg.tenantId,
          outcome: "success", details: { before: { taxProofCutoff: beforeMd }, after: { taxProofCutoff: p.md }, reason: p.reason ?? null },
        },
      });
    });
  });

  // ── verified-amount TDS opt-in (first FY, or null = off) ──────────────────
  queue.subscribe(COMMANDS.taxProofVerifiedFromSet, async (raw) => {
    const msg = raw as unknown as Msg;
    const p = msg.payload as { fy: string | null; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = rowsOf(await tx.execute(sql`
        SELECT tax_proof_verified_from_fy AS fy FROM payroll.payroll_settings WHERE tenant_id = ${msg.tenantId}::uuid FOR UPDATE
      `))[0];
      const beforeFy = before && before.fy ? String(before.fy) : null;
      await tx.execute(sql`
        INSERT INTO payroll.payroll_settings (tenant_id, tax_proof_verified_from_fy)
        VALUES (${msg.tenantId}::uuid, ${p.fy})
        ON CONFLICT (tenant_id) DO UPDATE SET tax_proof_verified_from_fy = EXCLUDED.tax_proof_verified_from_fy, updated_at = now()
      `);
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "payroll", action: "verified_tds_update", resourceType: "payroll_tax_proof_settings", resourceId: msg.tenantId,
          outcome: "success", details: { before: { taxProofVerifiedFromFy: beforeFy }, after: { taxProofVerifiedFromFy: p.fy }, reason: p.reason ?? null },
        },
      });
    });
  });

  // ── view audit (read-side) ────────────────────────────────────────────────
  queue.subscribe(COMMANDS.taxProofViewAudit, async (raw) => {
    const msg = raw as unknown as Msg;
    const p = msg.payload as { id: string; details: Record<string, unknown> };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await audit(tx, msg, "view", p.id, p.details);
    });
  });

  // ── scheduled retention purge (one command per tenant) ────────────────────
  queue.subscribe(COMMANDS.taxProofPurge, async (raw) => {
    const msg = raw as unknown as Msg;
    const res = await purgeTenantProofs(msg);
    if (res.purged > 0 || res.failed > 0) log.info({ tenantId: msg.tenantId, ...res }, "tax proof retention purge");
  });
}
