/**
 * Section 8 NF-3 (B1 part b): the finance.gl.rejected reconciler for grant postings.
 *
 * WHY: postGrantEventTx writes the append-only gl.grant_postings row (and, for a recognition, the utilisation row; for a first
 * receipt, flips the grant to active) in the request transaction and only THEN publishes the journal on finance.gl.post. If the
 * GL consumer later refuses that journal (period closed after accept, chart change, ...), the register believes in a posting the
 * ledger never got. gl/consumer.ts reports every deterministic refusal as finance.gl.rejected; this consumer closes the loop.
 *
 * CONTRACT
 *   in : finance.gl.rejected { journalId, code, reason, ... } (the producer's own event; finance-service subscribes to it)
 *   out: for a journal that IS a grant posting (gl.grant_postings.journal_id = journalId) of a fund_accounting tenant, ONE row in
 *        gl.grant_posting_voids (append-only) plus, in the same transaction:
 *          - the posting drops out of every running total (headroom, UC totals, fund statements) -- see grantTotalsTx;
 *          - recognition: grant_utilisation for the posting's period gives the amount back; receipt/recognition move the
 *            unspent snapshot of that period and every later period;
 *          - grant status: active -> sanctioned when no live (non-voided) posting remains. (closed is never touched.)
 *          - needs_review is set when the remaining live postings no longer fit (e.g. a recognition that leaned on the voided receipt).
 *   gate: stored settings only (gl.finance_settings.fund_accounting via loadPostingSettingsTx), never edition. A non-fund tenant, a
 *        journal that is not a grant posting (any other module's rejection), or a journal that actually exists in the ledger
 *        (a stale rejection) is ignored: nothing is written.
 *   idempotent: UNIQUE (tenant_id, journal_id) + a pre-check under the grant row lock, and markProcessed on the message id. A
 *        re-delivery, or a second rejection of the same journal after a replay, writes nothing.
 */
import { and, eq, sql } from "drizzle-orm";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import { loadPostingSettingsTx } from "../approvals/posting-settings.js";
import { auditEvent, type ActorMeta } from "../approvals/apply.js";
import { grants, grantPostings, grantPostingVoids } from "./schema.js";
import { grantTotalsTx } from "./service.js";
import { totalsAreConsistent, type GrantTotals } from "./domain.js";

const log = pino({ name: "finance:grant-reconciler" });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;
type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { rows?: Row[] })?.rows ?? [])) as Row[];

export type GlRejectedPayload = { journalId?: unknown; code?: unknown; reason?: unknown };
export type VoidOutcome = { voided: boolean; reason: "voided" | "not_enabled" | "not_a_grant_posting" | "journal_exists" | "already_voided" };

/** Void the grant posting behind a rejected journal, if there is one. Runs inside the caller's tenant-scoped transaction. */
export async function reconcileRejectedGrantPostingTx(tx: Tx, meta: ActorMeta, p: GlRejectedPayload): Promise<VoidOutcome> {
  if (typeof p.journalId !== "string") return { voided: false, reason: "not_a_grant_posting" };
  const ps = await loadPostingSettingsTx(tx, meta.tenantId);
  if (!ps.fundAccounting) return { voided: false, reason: "not_enabled" };

  const [posting] = await tx.select().from(grantPostings)
    .where(and(eq(grantPostings.tenantId, meta.tenantId), eq(grantPostings.journalId, p.journalId))).limit(1);
  if (!posting) return { voided: false, reason: "not_a_grant_posting" };

  // Serialise with postGrantEventTx and with a concurrent duplicate rejection.
  await tx.execute(sql`SELECT id FROM gl.grants WHERE tenant_id = ${meta.tenantId}::uuid AND id = ${posting.grantId}::uuid FOR UPDATE`);
  const already = rowsOf(await tx.execute(sql`SELECT 1 AS x FROM gl.grant_posting_voids WHERE tenant_id = ${meta.tenantId}::uuid AND journal_id = ${p.journalId}::uuid`));
  if (already.length > 0) return { voided: false, reason: "already_voided" };
  // A rejection is only meaningful while the journal does not exist (e.g. a dead-lettered message re-driven after the chart was fixed).
  const posted = rowsOf(await tx.execute(sql`SELECT 1 AS x FROM gl.finance_journals WHERE tenant_id = ${meta.tenantId}::uuid AND id = ${p.journalId}::uuid`));
  if (posted.length > 0) return { voided: false, reason: "journal_exists" };

  const before: GrantTotals = await grantTotalsTx(tx, meta.tenantId, posting.grantId);
  const after: GrantTotals = { ...before, [posting.kind]: before[posting.kind as keyof GrantTotals] - posting.amountMinor };
  const code = typeof p.code === "string" && p.code ? p.code : "GL_REJECTED";
  const reason = typeof p.reason === "string" ? p.reason : null;

  const inserted = await tx.insert(grantPostingVoids).values({
    tenantId: meta.tenantId, grantId: posting.grantId, grantPostingId: posting.id, journalId: p.journalId, kind: posting.kind,
    amountMinor: posting.amountMinor, rejectCode: code, rejectReason: reason, needsReview: !totalsAreConsistent(after),
  }).onConflictDoNothing({ target: [grantPostingVoids.tenantId, grantPostingVoids.journalId] }).returning({ id: grantPostingVoids.id });
  if (inserted.length === 0) return { voided: false, reason: "already_voided" };

  // Utilisation snapshots (per period). Recognition gives its amount back; receipt and recognition move the unspent balance of
  // the posting's period and every later one (each snapshot is cumulative).
  if (posting.kind === "recognition") {
    await tx.execute(sql`UPDATE gl.grant_utilisation
        SET amount_utilised_minor = GREATEST(amount_utilised_minor - ${posting.amountMinor}, 0), updated_by = ${meta.actorId}::uuid, updated_at = now()
      WHERE tenant_id = ${meta.tenantId}::uuid AND grant_id = ${posting.grantId}::uuid AND period = ${posting.period}`);
  }
  if (posting.kind === "recognition" || posting.kind === "receipt") {
    const delta = posting.kind === "recognition" ? posting.amountMinor : -posting.amountMinor;
    await tx.execute(sql`UPDATE gl.grant_utilisation
        SET unspent_balance_minor = unspent_balance_minor + ${delta}, updated_by = ${meta.actorId}::uuid, updated_at = now()
      WHERE tenant_id = ${meta.tenantId}::uuid AND grant_id = ${posting.grantId}::uuid AND period >= ${posting.period}`);
  }
  // Status: the first receipt flipped sanctioned -> active; with no live posting left the grant goes back.
  const live = rowsOf(await tx.execute(sql`SELECT 1 AS x FROM gl.grant_postings gp
      WHERE gp.tenant_id = ${meta.tenantId}::uuid AND gp.grant_id = ${posting.grantId}::uuid
        AND NOT EXISTS (SELECT 1 FROM gl.grant_posting_voids v WHERE v.tenant_id = gp.tenant_id AND v.journal_id = gp.journal_id) LIMIT 1`));
  if (live.length === 0) {
    await tx.update(grants).set({ status: "sanctioned", updatedBy: meta.actorId, updatedAt: new Date(), version: sql`${grants.version} + 1` })
      .where(and(eq(grants.tenantId, meta.tenantId), eq(grants.id, posting.grantId), eq(grants.status, "active")));
  }
  await auditEvent(tx, meta, "void_grant_posting", "grant", posting.grantId, {
    postingId: posting.id, journalId: p.journalId, kind: posting.kind, amountMinor: posting.amountMinor.toString(), code, needsReview: !totalsAreConsistent(after),
  });
  return { voided: true, reason: "voided" };
}

export function registerGrantReconciler(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.glRejected, async (msg) => {
    const p = msg.payload as GlRejectedPayload;
    if (typeof p?.journalId !== "string") return;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const out = await reconcileRejectedGrantPostingTx(tx, { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId ?? msg.messageId }, p);
      if (out.voided) log.warn({ tenantId: msg.tenantId, journalId: p.journalId, code: p.code }, "grant posting voided: its journal was refused by the GL");
    });
  });
}
