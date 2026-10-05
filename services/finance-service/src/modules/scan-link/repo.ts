/**
 * Scan-link (Finance target) — repo. Owns payments.finance_scanned_documents.
 *
 * L2 module isolation: the link targets live in other modules' schemas (payments.finance_bills /
 * finance_payments, gl.finance_journals). This repo does NOT import those modules' repos or schema files; it
 * reads the few columns it needs through minimal local read-only table views, one row at a time by primary key
 * (no JOINs), always tenant-scoped and under the tenant GUC (RLS).
 */
import { and, eq, sql } from "drizzle-orm";
import { pgSchema, uuid, text, bigint, jsonb } from "drizzle-orm/pg-core";
import { db, scopedRead } from "../../shared/db.js";
import { financeScannedDocuments as t, type ScannedDocumentRow } from "./schema.js";
import { normaliseReference, type ScanTargetKind, type TargetFacts } from "./match.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const payments = pgSchema("payments");
const gl = pgSchema("gl");
const billView = payments.table("finance_bills", {
  id: uuid("id"), tenantId: uuid("tenant_id"), billNo: text("bill_no"),
  grossMinor: bigint("gross_minor", { mode: "bigint" }), netMinor: bigint("net_minor", { mode: "bigint" }),
});
const paymentView = payments.table("finance_payments", {
  id: uuid("id"), tenantId: uuid("tenant_id"), eftRef: text("eft_ref"), utr: text("utr"),
  amountMinor: bigint("amount_minor", { mode: "bigint" }),
});
const journalView = gl.table("finance_journals", {
  id: uuid("id"), tenantId: uuid("tenant_id"), voucherNo: text("voucher_no"),
  lines: jsonb("lines").$type<Array<{ debitMinor?: string | number | null }>>(),
});

/** Same fallback label the payments register shows when a payment has no EFT ref. */
export function paymentFallbackRef(id: string): string {
  return "PAY-" + id.slice(-6).toUpperCase();
}

function sumDebits(lines: Array<{ debitMinor?: string | number | null }> | null): bigint {
  let total = 0n;
  for (const l of lines ?? []) {
    const raw = l.debitMinor == null ? "0" : String(l.debitMinor);
    if (/^\d+$/.test(raw)) total += BigInt(raw);
  }
  return total;
}

export interface TargetRecord extends TargetFacts { label: string }

/** Load the target by PK inside the caller's tenant tx. null when missing or in another tenant. */
export async function loadTarget(tx: Tx, tenantId: string, kind: ScanTargetKind, id: string): Promise<TargetRecord | null> {
  if (kind === "finance_bill") {
    const [r] = await tx.select().from(billView).where(and(eq(billView.id, id), eq(billView.tenantId, tenantId))).limit(1);
    if (!r) return null;
    const gross = r.grossMinor ?? 0n;
    const net = r.netMinor ?? 0n;
    return { label: r.billNo ?? id, references: [r.billNo], amountsMinor: gross === net ? [gross] : [gross, net] };
  }
  if (kind === "finance_payment") {
    const [r] = await tx.select().from(paymentView).where(and(eq(paymentView.id, id), eq(paymentView.tenantId, tenantId))).limit(1);
    if (!r) return null;
    const fallback = paymentFallbackRef(id);
    return { label: r.eftRef ?? fallback, references: [r.eftRef, r.utr, fallback], amountsMinor: [r.amountMinor ?? 0n] };
  }
  const [r] = await tx.select().from(journalView).where(and(eq(journalView.id, id), eq(journalView.tenantId, tenantId))).limit(1);
  if (!r) return null;
  return { label: r.voucherNo ?? id, references: [r.voucherNo], amountsMinor: [sumDebits(r.lines)] };
}

export async function insertLinked(tx: Tx, row: typeof t.$inferInsert): Promise<boolean> {
  const inserted = await tx.insert(t).values(row).onConflictDoNothing({ target: [t.tenantId, t.linkId] }).returning({ id: t.id });
  return inserted.length > 0;
}

export async function findByLink(tx: Tx, tenantId: string, linkId: string): Promise<ScannedDocumentRow | null> {
  const [r] = await tx.select().from(t).where(and(eq(t.tenantId, tenantId), eq(t.linkId, linkId))).limit(1);
  return r ?? null;
}

/** Race-safe: only a currently-linked row transitions. Returns true when this call performed the transition. */
export async function markUnlinked(tx: Tx, p: { tenantId: string; linkId: string; reason: string; actorId: string }): Promise<boolean> {
  const now = new Date();
  const updated = await tx.update(t).set({
    state: "unlinked", unlinkReason: p.reason, unlinkedBy: p.actorId, unlinkedAt: now, updatedAt: now,
    version: sql`${t.version} + 1`,
  }).where(and(eq(t.tenantId, p.tenantId), eq(t.linkId, p.linkId), eq(t.state, "linked"))).returning({ id: t.id });
  return updated.length > 0;
}

export async function listForTarget(tenantId: string, kind: ScanTargetKind, id: string): Promise<ScannedDocumentRow[]> {
  return scopedRead((tx) => tx.select().from(t)
    .where(and(eq(t.tenantId, tenantId), eq(t.targetKind, kind), eq(t.targetId, id), eq(t.state, "linked")))
    .orderBy(sql`${t.createdAt} DESC, ${t.id} DESC`).limit(100));
}

/** Read-side existence check (tenant scoped, RLS). */
export async function targetExists(tenantId: string, kind: ScanTargetKind, id: string): Promise<boolean> {
  return scopedRead(async (tx) => (await loadTarget(tx as unknown as Tx, tenantId, kind, id)) !== null);
}

export interface LookupRow { id: string; label: string; reference: string | null; amountsMinor: bigint[] }

/**
 * Candidates whose normalised reference equals `refNorm` (index-backed by the *_refnorm indexes of migration
 * 0091 -- keep the expression identical). Max `limit` rows per kind. Amounts are returned as bigint.
 */
export async function lookupByReference(tenantId: string, kind: ScanTargetKind, refNorm: string, limit: number): Promise<LookupRow[]> {
  if (refNorm === "") return [];
  return scopedRead(async (tx) => {
    if (kind === "finance_bill") {
      const rows = await tx.execute(sql`
        SELECT id::text AS id, bill_no AS ref, gross_minor::text AS gross, net_minor::text AS net
        FROM payments.finance_bills
        WHERE tenant_id = ${tenantId}::uuid AND regexp_replace(lower(bill_no), '[^a-z0-9]', '', 'g') = ${refNorm}
        ORDER BY created_at DESC, id LIMIT ${limit}`);
      return (rows as unknown as Array<{ id: string; ref: string; gross: string; net: string }>).map((r) => ({
        id: r.id, label: r.ref, reference: r.ref,
        amountsMinor: r.gross === r.net ? [BigInt(r.gross)] : [BigInt(r.gross), BigInt(r.net)],
      }));
    }
    if (kind === "finance_payment") {
      const rows = await tx.execute(sql`
        SELECT id::text AS id, eft_ref AS ref, amount_minor::text AS amt
        FROM payments.finance_payments
        WHERE tenant_id = ${tenantId}::uuid AND regexp_replace(lower(coalesce(eft_ref, '')), '[^a-z0-9]', '', 'g') = ${refNorm}
        ORDER BY created_at DESC, id LIMIT ${limit}`);
      return (rows as unknown as Array<{ id: string; ref: string | null; amt: string }>).map((r) => ({
        id: r.id, label: r.ref ?? paymentFallbackRef(r.id), reference: r.ref, amountsMinor: [BigInt(r.amt)],
      }));
    }
    const rows = await tx.execute(sql`
      SELECT j.id::text AS id, j.voucher_no AS ref,
             (SELECT COALESCE(SUM(CASE WHEN (l->>'debitMinor') ~ '^[0-9]+$' THEN (l->>'debitMinor')::numeric ELSE 0 END), 0)
                FROM jsonb_array_elements(j.lines) AS l)::text AS amt
      FROM gl.finance_journals j
      WHERE j.tenant_id = ${tenantId}::uuid AND regexp_replace(lower(j.voucher_no), '[^a-z0-9]', '', 'g') = ${refNorm}
      ORDER BY j.created_at DESC, j.id LIMIT ${limit}`);
    return (rows as unknown as Array<{ id: string; ref: string; amt: string }>).map((r) => ({
      id: r.id, label: r.ref, reference: r.ref, amountsMinor: [BigInt(r.amt)],
    }));
  });
}

export { normaliseReference };
