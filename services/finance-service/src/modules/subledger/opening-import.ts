/**
 * AR sub-ledger opening-balance import (finance-service).
 *
 * Eight billing invoices were posted to GL control account 1300 before the AR sub-ledger consumer existed (B22 D5),
 * so gl.finance_ar_ledger sat short of the control head. No route wrote AR rows without also posting a journal, and a
 * journal is exactly what must NOT happen here (the 1300 side is already in the GL). This module adds:
 *
 *   POST /v1/finance/ar/opening-balances            raise a maker-checker request to write AR rows (AR-only)
 *   POST /v1/finance/ar/opening-balances/backfill   dry run (default) lists billing invoices on 1300 with no AR row;
 *                                                   dryRun:false raises ONE request for exactly those invoices
 *
 * Both are change requests (kind ar_opening_balance) a DIFFERENT finance_admin / super_admin approves through the
 * existing /v1/finance/change-requests/:id/approve. The approval runs applyArOpeningBalances: it inserts into
 * gl.finance_ar_ledger only (never a journal, never the GL ledger), skips any demand_id that already has a row (so
 * it never duplicates one the billing consumer wrote and a replay is a no-op) and records an audit event.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { todayIST } from "../../shared/ist-date.js";
import { deterministicId } from "../gl/spine.js";
import { auditEvent, lockTenant, type ActorMeta, type Tx } from "../approvals/apply.js";
import { submitChangeRequest } from "../approvals/commands.js";
import { DomainError } from "../approvals/domain.js";

export const AR_IMPORT_ROLES = ["finance_admin", "super_admin"];
/** The debtor identity the billing consumer writes (the billed customer is the tenant itself). */
export const BILLING_DEBTOR_NAME = "Platform subscription billing";
const MAX_ENTRIES = 500;

const rowsOf = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] } | undefined)?.rows ?? [])) as Array<Record<string, unknown>>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD").refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "not a real date");
const minorString = z.string().regex(/^\d{1,18}$/, "amount in paise as a digit string");

export const arOpeningEntrySchema = z.object({
  debtorName: z.string().trim().min(1).max(256),
  debtorId: z.string().uuid().optional(),
  /** The billing invoice id (or the demand id for a non-billing receivable); the idempotency key. */
  demandId: z.string().uuid(),
  amountMinor: minorString.refine((v) => BigInt(v) > 0n, "amount must be greater than zero"),
  /** Part already collected (default 0). The row's balance is amount - received. */
  receivedMinor: minorString.optional(),
  invoiceDate: isoDate,
  dueDate: isoDate.optional(),
}).refine((e) => e.receivedMinor === undefined || BigInt(e.receivedMinor) <= BigInt(e.amountMinor), { message: "receivedMinor cannot exceed amountMinor", path: ["receivedMinor"] })
  .refine((e) => e.dueDate === undefined || e.dueDate >= e.invoiceDate, { message: "dueDate cannot be before invoiceDate", path: ["dueDate"] });
export type ArOpeningEntry = z.infer<typeof arOpeningEntrySchema>;

const entriesSchema = z.array(arOpeningEntrySchema).min(1).max(MAX_ENTRIES)
  .refine((es) => new Set(es.map((e) => e.demandId.toLowerCase())).size === es.length, "demandId repeated in the same request");
const reasonSchema = z.string().trim().min(10, "Reason must be at least 10 characters").max(500);

const importBody = z.object({ entries: entriesSchema, reason: reasonSchema });
const backfillBody = z.object({
  dryRun: z.boolean().default(true),
  reason: reasonSchema.optional(),
  /** Name shown for the billed customer; defaults to the one the billing consumer uses. */
  debtorName: z.string().trim().min(1).max(256).optional(),
});

/** Aging bucket (the column's CHECK values) by days past the due date (invoice date when no due date). */
export function agingBucket(dueOrInvoiceDate: string, asOf: string): "0-30" | "31-60" | "61-90" | "91-180" | "180+" {
  const days = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueOrInvoiceDate}T00:00:00Z`)) / 86_400_000);
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  if (days <= 180) return "91-180";
  return "180+";
}

/** One pending request per distinct set of demand ids. */
export function subjectKeyFor(entries: ReadonlyArray<{ demandId: string }>): string {
  const ids = entries.map((e) => e.demandId.toLowerCase()).sort().join(",");
  return `ar-opening:${createHash("sha256").update(ids).digest("hex").slice(0, 24)}`;
}

/**
 * Approved-request effect. Writes gl.finance_ar_ledger ONLY. Validates before writing; skips a demand_id that already
 * has a row (idempotent, and never a duplicate of a row the consumer wrote).
 */
export async function applyArOpeningBalances(
  tx: Tx, meta: ActorMeta, p: { entries: ArOpeningEntry[]; reason: string; requestId?: string },
): Promise<{ imported: number; skipped: string[]; importedMinor: string }> {
  const parsed = entriesSchema.safeParse(p.entries);
  if (!parsed.success) throw new DomainError("AR_OPENING_INVALID", parsed.error.issues.map((i) => i.message).join("; "));
  await lockTenant(tx, "ar-ledger", meta.tenantId);
  const today = todayIST();
  const skipped: string[] = [];
  let imported = 0;
  let importedMinor = 0n;
  for (const e of parsed.data) {
    const amount = BigInt(e.amountMinor);
    const received = BigInt(e.receivedMinor ?? "0");
    const balance = amount - received;
    const status = balance === 0n ? "paid" : received > 0n ? "partial" : "open";
    const bucket = agingBucket(e.dueDate ?? e.invoiceDate, today);
    const debtorId = e.debtorId ?? deterministicId(`ar_debtor:${meta.tenantId}:${e.debtorName.toLowerCase()}`);
    const inserted = rowsOf(await tx.execute(sql`
      INSERT INTO gl.finance_ar_ledger (tenant_id, debtor_id, debtor_name, demand_id, invoice_date, due_date, amount_minor, received_minor, balance_minor, aging_bucket, status, source, change_request_id)
      SELECT ${meta.tenantId}::uuid, ${debtorId}::uuid, ${e.debtorName}, ${e.demandId}::uuid, ${e.invoiceDate}::date, ${e.dueDate ?? null}::date,
             ${amount}::bigint, ${received}::bigint, ${balance}::bigint, ${bucket}, ${status}, 'opening_import', ${p.requestId ?? null}::uuid
      WHERE NOT EXISTS (SELECT 1 FROM gl.finance_ar_ledger WHERE tenant_id = ${meta.tenantId}::uuid AND demand_id = ${e.demandId}::uuid)
      RETURNING id`));
    if (inserted.length === 0) { skipped.push(e.demandId); continue; }
    imported += 1;
    importedMinor += balance;
  }
  await auditEvent(tx, meta, "ar_opening_import", "ar_ledger", p.requestId ?? meta.tenantId, {
    imported, skippedExisting: skipped, openBalanceImportedMinor: importedMinor.toString(), reason: p.reason,
    glJournalPosted: false, ...(p.requestId ? { changeRequestId: p.requestId } : {}),
  });
  return { imported, skipped, importedMinor: importedMinor.toString() };
}

async function existingDemandIds(tenantId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = rowsOf(await scopedRead((tx) => tx.execute(sql`
    SELECT demand_id::text AS demand_id FROM gl.finance_ar_ledger
    WHERE tenant_id = ${tenantId}::uuid AND demand_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`)));
  return new Set(rows.map((r) => String(r.demand_id).toLowerCase()));
}

const controlCode = () => process.env.FINANCE_AR_CONTROL_CODE ?? "1300";

export type BackfillCandidate = {
  demandId: string; invoiceDate: string; amountMinor: string; receivedMinor: string; balanceMinor: string;
};

/**
 * Billing invoices that debit the AR control head (a posted billing_revenue_recognition journal, narration
 * "Invoice receivable <invoiceId>") and have no gl.finance_ar_ledger row. The amount and date are the journal's own;
 * what the matching billing_cash_receipt journals cleared ("Receivable cleared <invoiceId>") is the received part.
 */
export async function findBackfillCandidates(tenantId: string): Promise<BackfillCandidate[]> {
  const code = controlCode();
  const headRows = rowsOf(await scopedRead((tx) => tx.execute(sql`
    SELECT id::text AS id FROM budget.finance_heads WHERE tenant_id = ${tenantId}::uuid AND code = ${code} LIMIT 1`)));
  const headId = (headRows[0]?.id as string | undefined) ?? code;
  const rows = rowsOf(await scopedRead((tx) => tx.execute(sql`
    WITH recog AS (
      SELECT substring(l->>'narration' from 'Invoice receivable ([0-9a-fA-F-]{36})$') AS inv,
             j.posting_date, (l->>'debitMinor')::bigint AS amt
      FROM gl.finance_journals j, jsonb_array_elements(j.lines) l
      WHERE j.tenant_id = ${tenantId}::uuid AND j.type = 'billing_revenue_recognition' AND j.status = 'posted'
        AND l->>'accountCode' IN (${code}, ${headId}) AND (l->>'debitMinor') ~ '^[0-9]+$'
    ), cleared AS (
      SELECT substring(l->>'narration' from 'Receivable cleared ([0-9a-fA-F-]{36})$') AS inv,
             SUM((l->>'creditMinor')::bigint) AS paid
      FROM gl.finance_journals j, jsonb_array_elements(j.lines) l
      WHERE j.tenant_id = ${tenantId}::uuid AND j.type = 'billing_cash_receipt' AND j.status = 'posted'
        AND l->>'accountCode' IN (${code}, ${headId}) AND (l->>'creditMinor') ~ '^[0-9]+$'
      GROUP BY 1
    )
    SELECT lower(r.inv) AS demand_id, r.posting_date::text AS invoice_date, r.amt::text AS amount_minor,
           LEAST(COALESCE(c.paid, 0), r.amt)::text AS received_minor
    FROM recog r LEFT JOIN cleared c ON lower(c.inv) = lower(r.inv)
    WHERE r.inv IS NOT NULL AND r.amt > 0
      AND NOT EXISTS (SELECT 1 FROM gl.finance_ar_ledger a WHERE a.tenant_id = ${tenantId}::uuid AND a.demand_id = lower(r.inv)::uuid)
    ORDER BY r.posting_date, r.inv`)));
  return rows.map((r) => ({
    demandId: String(r.demand_id), invoiceDate: String(r.invoice_date), amountMinor: String(r.amount_minor), receivedMinor: String(r.received_minor),
    balanceMinor: (BigInt(String(r.amount_minor)) - BigInt(String(r.received_minor))).toString(),
  }));
}

async function arPosition(tenantId: string): Promise<{ subledgerMinor: bigint; controlMinor: bigint }> {
  const code = controlCode();
  const sub = rowsOf(await scopedRead((tx) => tx.execute(sql`
    SELECT COALESCE(SUM(balance_minor), 0)::text AS total FROM gl.finance_ar_ledger WHERE tenant_id = ${tenantId}::uuid AND status <> 'paid'`)));
  const ctrl = rowsOf(await scopedRead((tx) => tx.execute(sql`
    SELECT COALESCE(SUM(l.debit_minor) - SUM(l.credit_minor), 0)::text AS total
    FROM gl.finance_ledger l JOIN budget.finance_heads h ON h.id = l.head_id AND h.tenant_id = l.tenant_id
    WHERE l.tenant_id = ${tenantId}::uuid AND h.code = ${code}`)));
  return { subledgerMinor: BigInt(String(sub[0]?.total ?? "0")), controlMinor: BigInt(String(ctrl[0]?.total ?? "0")) };
}

export async function arOpeningRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/finance/ar/opening-balances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AR_IMPORT_ROLES);
    const body = importBody.parse(req.body);
    const present = await existingDemandIds(ctx.tenantId, body.entries.map((e) => e.demandId));
    if (present.size === body.entries.length) {
      throw new HttpError(409, "AR_OPENING_ALREADY_PRESENT", "every demand_id in this request already has an AR sub-ledger row; nothing to import");
    }
    const accepted = await submitChangeRequest(ctx, "ar_opening_balance", subjectKeyFor(body.entries), { entries: body.entries }, body.reason);
    return reply.code(202).send({
      ...accepted, entryCount: body.entries.length, alreadyPresent: [...present],
      totalMinor: body.entries.reduce((s, e) => s + BigInt(e.amountMinor) - BigInt(e.receivedMinor ?? "0"), 0n).toString(),
    });
  });

  app.post("/v1/finance/ar/opening-balances/backfill", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AR_IMPORT_ROLES);
    const body = backfillBody.parse(req.body ?? {});
    const all = await findBackfillCandidates(ctx.tenantId);
    const candidates = all.slice(0, MAX_ENTRIES);
    const openMinor = candidates.reduce((s, c) => s + BigInt(c.balanceMinor), 0n);
    const pos = await arPosition(ctx.tenantId);
    const view = {
      controlAccountCode: controlCode(), candidates, candidateCount: all.length, truncated: all.length > candidates.length,
      candidateOpenMinor: openMinor.toString(),
      subledgerBalanceMinor: pos.subledgerMinor.toString(), controlAccountBalanceMinor: pos.controlMinor.toString(),
      differenceMinor: (pos.subledgerMinor - pos.controlMinor).toString(),
      differenceAfterMinor: (pos.subledgerMinor + openMinor - pos.controlMinor).toString(),
    };
    if (body.dryRun) return reply.send({ dryRun: true, ...view });
    if (!body.reason) throw new HttpError(400, "VALIDATION_ERROR", "reason (at least 10 characters) is required to apply the backfill");
    if (candidates.length === 0) throw new HttpError(409, "AR_BACKFILL_NOTHING_TO_DO", "no billing invoice on the AR control account is missing from the AR sub-ledger");
    const debtorName = body.debtorName ?? BILLING_DEBTOR_NAME;
    const entries: ArOpeningEntry[] = candidates.map((c) => ({
      debtorName, debtorId: ctx.tenantId, demandId: c.demandId, amountMinor: c.amountMinor,
      ...(c.receivedMinor !== "0" ? { receivedMinor: c.receivedMinor } : {}), invoiceDate: c.invoiceDate,
    }));
    const accepted = await submitChangeRequest(ctx, "ar_opening_balance", subjectKeyFor(entries), { entries, source: "backfill" }, body.reason);
    return reply.code(202).send({ dryRun: false, ...accepted, ...view });
  });
}
