/**
 * Section 8 NF-3: grants-in-aid register + postings. Everything runs inside the caller's tenant-scoped transaction.
 *
 * FLAG GATE: every operation first reads gl.finance_settings ONCE (loadPostingSettingsTx -- the same single read that yields
 * fund_accounting, the GENERAL fund and, since NF-3, capital_grant_policy) and REFUSES with GRANTS_NOT_ENABLED while
 * fund_accounting is off, before any write or enqueue. A govt tenant therefore never gets a gl.grants row, a grant posting or
 * a grant journal: its ledger is byte-identical.
 *
 * POSTING: a grant posting validates through the NF-1 fund path (fundContext + prepareFundPostingTx: fund exists and is
 * active, restricted/corpus rows locked, per-fund balance) and then publishes the journal on finance.gl.post, whose consumer
 * (gl/consumer.ts postJournal) re-runs the same fund seam authoritatively at posting time and writes the ledger. This module
 * writes no journal / ledger row itself. The journal id is deterministic from the posting id, so a redelivery is a no-op.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { DomainError } from "../approvals/domain.js";
import { loadPostingSettingsTx, type CapitalGrantPolicy, type PostingSettings } from "../approvals/posting-settings.js";
import { financeSettings } from "../approvals/schema.js";
import { auditEvent, type ActorMeta } from "../approvals/apply.js";
import { fundContext } from "../gl/fund-context.js";
import { funds } from "../gl/schema.js";
import { assertFundHeadsPresentTx, prepareFundPostingTx } from "../gl/funds.js";
import { deterministicId } from "../gl/spine.js";
import { enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import {
  grants, grantPostings, grantUtilisation, type GrantRow, type GrantCategory, type GrantPostingKind, type InterestTreatment,
} from "./schema.js";
import {
  assertHeadroom, buildGrantJournal, journalHeadCodes, unspentMinor, ZERO_TOTALS, CAPITAL_GRANT_POLICIES, type GrantTotals,
} from "./domain.js";

// The shared db.transaction callback hands out the full db surface (see shared/db.ts scopedRead), so tx is untyped here like funds.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;
type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { rows?: Row[] })?.rows ?? [])) as Row[];

/** The settings read + flag gate. Returns the snapshot so the caller reuses it (policy, GENERAL fund) without a second read. */
export async function requireGrantsEnabledTx(tx: Tx, tenantId: string): Promise<PostingSettings> {
  const ps = await loadPostingSettingsTx(tx, tenantId);
  if (!ps.fundAccounting) throw new DomainError("GRANTS_NOT_ENABLED", "grants-in-aid need fund accounting, which is not enabled for this tenant");
  return ps;
}

export type CreateGrantInput = {
  fundId: string; category: GrantCategory; grantor: string; schemeCode?: string | undefined; sanctionRef: string;
  sanctionDate: string; amountSanctionedMinor: bigint; currency?: string | undefined;
};

/** Register a sanction against one fund. */
export async function createGrantTx(tx: Tx, meta: ActorMeta, input: CreateGrantInput): Promise<GrantRow> {
  await requireGrantsEnabledTx(tx, meta.tenantId);
  if (input.amountSanctionedMinor <= 0n) throw new DomainError("GRANT_AMOUNT", "the sanctioned amount must be greater than zero");
  const [fund] = await tx.select().from(funds).where(and(eq(funds.tenantId, meta.tenantId), eq(funds.id, input.fundId))).limit(1);
  if (!fund) throw new DomainError("FUND_NOT_FOUND", `fund ${input.fundId} does not exist for this tenant`);
  if (fund.status !== "active") throw new DomainError("FUND_CLOSED", `fund ${fund.code} is closed and cannot take a grant`);
  const inserted = await tx.insert(grants).values({
    tenantId: meta.tenantId, fundId: input.fundId, category: input.category, grantor: input.grantor,
    schemeCode: input.schemeCode ?? null, sanctionRef: input.sanctionRef, sanctionDate: input.sanctionDate,
    amountSanctionedMinor: input.amountSanctionedMinor, currency: input.currency ?? "INR",
    createdBy: meta.actorId, updatedBy: meta.actorId,
  }).onConflictDoNothing({ target: [grants.tenantId, grants.grantor, grants.sanctionRef] }).returning();
  const row = inserted[0];
  if (!row) throw new DomainError("GRANT_EXISTS", `a grant with sanction ${input.sanctionRef} from ${input.grantor} is already registered`);
  await auditEvent(tx, meta, "create_grant", "grant", row.id, {
    fundId: input.fundId, category: input.category, sanctionRef: input.sanctionRef, amountSanctionedMinor: input.amountSanctionedMinor.toString(),
  });
  return row;
}

export async function listGrantsTx(tx: Tx, tenantId: string): Promise<GrantRow[]> {
  await requireGrantsEnabledTx(tx, tenantId);
  return tx.select().from(grants).where(eq(grants.tenantId, tenantId)).orderBy(asc(grants.sanctionDate), asc(grants.sanctionRef));
}

/** Running totals by posting kind, computed on read from the append-only trail. */
export async function grantTotalsTx(tx: Tx, tenantId: string, grantId: string): Promise<GrantTotals> {
  const rows = rowsOf(await tx.execute(sql`
    SELECT kind, COALESCE(SUM(amount_minor), 0)::text AS total FROM gl.grant_postings
     WHERE tenant_id = ${tenantId}::uuid AND grant_id = ${grantId}::uuid GROUP BY kind`));
  const t = { ...ZERO_TOTALS };
  for (const r of rows) t[String(r.kind) as GrantPostingKind] = BigInt(String(r.total));
  return t;
}

export async function getGrantTx(tx: Tx, tenantId: string, grantId: string): Promise<{ grant: GrantRow; totals: GrantTotals; unspentMinor: bigint }> {
  await requireGrantsEnabledTx(tx, tenantId);
  const [grant] = await tx.select().from(grants).where(and(eq(grants.tenantId, tenantId), eq(grants.id, grantId))).limit(1);
  if (!grant) throw new DomainError("GRANT_NOT_FOUND", "grant not found");
  const totals = await grantTotalsTx(tx, tenantId, grantId);
  return { grant, totals, unspentMinor: unspentMinor(totals) };
}

export type GrantPostingInput = {
  /** Idempotency: the posting id (and, through it, the journal id). A repeat with the same id returns the first result. */
  id?: string | undefined;
  grantId: string; amountMinor: bigint; postingDate: string; narration?: string | undefined;
  /** Receipts only: the bank / cash head to debit (default: the cash head, FINANCE_CASH_CODE / 1100). */
  bankHeadCode?: string | undefined;
};

/**
 * recordGrantReceipt / recogniseRevenueGrant / capitaliseGrant / releaseCapitalGrant: one grant money event.
 * Returns the posting id and the (deterministic) journal id that was published.
 */
export async function postGrantEventTx(
  tx: Tx, meta: ActorMeta, kind: GrantPostingKind, input: GrantPostingInput,
): Promise<{ postingId: string; journalId: string; replayed: boolean }> {
  const ps = await requireGrantsEnabledTx(tx, meta.tenantId);
  const postingId = input.id ?? randomUUID();
  const journalId = deterministicId(`grant_${kind}:${postingId}`);
  // Row-lock the grant: concurrent postings serialise, so the headroom read below is never stale.
  const locked = rowsOf(await tx.execute(sql`SELECT id FROM gl.grants WHERE tenant_id = ${meta.tenantId}::uuid AND id = ${input.grantId}::uuid FOR UPDATE`));
  if (locked.length === 0) throw new DomainError("GRANT_NOT_FOUND", "grant not found");
  const [existing] = await tx.select().from(grantPostings).where(and(eq(grantPostings.tenantId, meta.tenantId), eq(grantPostings.id, postingId))).limit(1);
  if (existing) {
    if (existing.grantId !== input.grantId || existing.kind !== kind) throw new DomainError("GRANT_POSTING_ID_REUSED", "this posting id was already used for a different grant event");
    return { postingId, journalId: existing.journalId, replayed: true };
  }
  const [grant] = await tx.select().from(grants).where(and(eq(grants.tenantId, meta.tenantId), eq(grants.id, input.grantId))).limit(1);
  if (!grant) throw new DomainError("GRANT_NOT_FOUND", "grant not found");
  if (grant.status === "closed") throw new DomainError("GRANT_CLOSED", `grant ${grant.sanctionRef} is closed`);

  const policy: CapitalGrantPolicy = ps.capitalGrantPolicy;
  const totals = await grantTotalsTx(tx, meta.tenantId, grant.id);
  assertHeadroom(kind, grant.category, policy, totals, grant.amountSanctionedMinor, input.amountMinor);
  const lines = buildGrantJournal(kind, {
    category: grant.category, policy, fundId: grant.fundId, amountMinor: input.amountMinor,
    ...(input.narration ? { narration: input.narration } : {}), ...(input.bankHeadCode ? { bankHeadCode: input.bankHeadCode } : {}),
  });
  try {
    await assertFundHeadsPresentTx(tx, meta.tenantId, journalHeadCodes(lines));
  } catch (err) {
    if (err instanceof DomainError && err.code === "FUND_HEADS_MISSING") throw new DomainError("GRANT_HEADS_MISSING", err.message.replace("the nonprofit chart is missing", "the chart is missing"));
    throw err;
  }
  // The NF-1 fund path, in this transaction: fund seam + existence / active / lock / per-fund balance / restricted-spend rules.
  const fx = await fundContext(tx, meta.tenantId, ps);
  await prepareFundPostingTx(tx, fx, meta.tenantId, { type: "journal", lines });

  await tx.insert(grantPostings).values({
    id: postingId, tenantId: meta.tenantId, grantId: grant.id, kind, amountMinor: input.amountMinor,
    postingDate: input.postingDate, period: input.postingDate.slice(0, 7), journalId, narration: input.narration ?? null, createdBy: meta.actorId,
  });
  if (kind === "recognition") {
    const period = input.postingDate.slice(0, 7);
    const unspentAfter = totals.receipt - (totals.recognition + input.amountMinor);
    await tx.insert(grantUtilisation).values({
      tenantId: meta.tenantId, grantId: grant.id, period, amountUtilisedMinor: input.amountMinor, unspentBalanceMinor: unspentAfter,
      createdBy: meta.actorId, updatedBy: meta.actorId,
    }).onConflictDoUpdate({
      target: [grantUtilisation.tenantId, grantUtilisation.grantId, grantUtilisation.period],
      set: {
        amountUtilisedMinor: sql`${grantUtilisation.amountUtilisedMinor} + ${input.amountMinor}`,
        unspentBalanceMinor: unspentAfter, updatedBy: meta.actorId, updatedAt: new Date(),
      },
    });
  }
  if (kind === "receipt" && grant.status === "sanctioned") {
    await tx.update(grants).set({ status: "active", updatedBy: meta.actorId, updatedAt: new Date(), version: sql`${grants.version} + 1` })
      .where(and(eq(grants.tenantId, meta.tenantId), eq(grants.id, grant.id)));
  }
  await enqueue(tx, {
    topic: COMMANDS.journalPost, eventType: COMMANDS.journalPost,
    tenantId: meta.tenantId, actorId: meta.actorId, correlationId: meta.correlationId,
    payload: {
      id: journalId, tenantId: meta.tenantId, voucherNo: "AUTO", type: "journal", postingDate: input.postingDate,
      lines: lines.map((l) => ({
        accountCode: l.accountCode, debitMinor: BigInt(l.debitMinor).toString(), creditMinor: BigInt(l.creditMinor).toString(),
        fundId: l.fundId, ...(l.narration ? { narration: l.narration } : {}),
      })),
    },
  });
  await auditEvent(tx, meta, `grant_${kind}`, "grant", grant.id, {
    postingId, journalId, amountMinor: input.amountMinor.toString(), postingDate: input.postingDate, policy,
  });
  return { postingId, journalId, replayed: false };
}

export const recordGrantReceiptTx = (tx: Tx, meta: ActorMeta, i: GrantPostingInput) => postGrantEventTx(tx, meta, "receipt", i);
export const recogniseRevenueGrantTx = (tx: Tx, meta: ActorMeta, i: GrantPostingInput) => postGrantEventTx(tx, meta, "recognition", i);
export const capitaliseGrantTx = (tx: Tx, meta: ActorMeta, i: GrantPostingInput) => postGrantEventTx(tx, meta, "capitalisation", i);
export const releaseCapitalGrantTx = (tx: Tx, meta: ActorMeta, i: GrantPostingInput) => postGrantEventTx(tx, meta, "release", i);

export type UtilisationMetaInput = {
  grantId: string; period: string;
  interestEarnedMinor?: bigint | undefined; interestTreatment?: InterestTreatment | null | undefined;
  ucForm?: string | null | undefined; ucSubmittedDate?: string | null | undefined;
};

/** UC / interest bookkeeping for one (grant, period). Posts nothing: the UC form number stays free text, the treatment nullable. */
export async function recordUtilisationMetaTx(tx: Tx, meta: ActorMeta, i: UtilisationMetaInput) {
  await requireGrantsEnabledTx(tx, meta.tenantId);
  const [grant] = await tx.select({ id: grants.id }).from(grants).where(and(eq(grants.tenantId, meta.tenantId), eq(grants.id, i.grantId))).limit(1);
  if (!grant) throw new DomainError("GRANT_NOT_FOUND", "grant not found");
  const totals = await grantTotalsTx(tx, meta.tenantId, i.grantId);
  const patch = {
    ...(i.interestEarnedMinor !== undefined ? { interestEarnedMinor: i.interestEarnedMinor } : {}),
    ...(i.interestTreatment !== undefined ? { interestTreatment: i.interestTreatment } : {}),
    ...(i.ucForm !== undefined ? { ucForm: i.ucForm } : {}),
    ...(i.ucSubmittedDate !== undefined ? { ucSubmittedDate: i.ucSubmittedDate } : {}),
  };
  const [row] = await tx.insert(grantUtilisation).values({
    tenantId: meta.tenantId, grantId: i.grantId, period: i.period, unspentBalanceMinor: unspentMinor(totals),
    createdBy: meta.actorId, updatedBy: meta.actorId, ...patch,
  }).onConflictDoUpdate({
    target: [grantUtilisation.tenantId, grantUtilisation.grantId, grantUtilisation.period],
    set: { ...patch, updatedBy: meta.actorId, updatedAt: new Date() },
  }).returning();
  await auditEvent(tx, meta, "record_grant_utilisation", "grant", i.grantId, { period: i.period, ucForm: i.ucForm ?? null });
  return row;
}

/** Set the per-tenant capital-grant policy. Refused by the database (GRANT_POLICY_LOCKED) once a capital grant has postings. */
export async function setCapitalGrantPolicyTx(tx: Tx, meta: ActorMeta, policy: CapitalGrantPolicy, reason: string): Promise<void> {
  await requireGrantsEnabledTx(tx, meta.tenantId);
  if (!CAPITAL_GRANT_POLICIES.includes(policy)) throw new DomainError("GRANT_POLICY_INVALID", `unknown capital-grant policy ${String(policy)}`);
  try {
    await tx.insert(financeSettings).values({ tenantId: meta.tenantId, capitalGrantPolicy: policy, updatedBy: meta.actorId })
      .onConflictDoUpdate({
        target: financeSettings.tenantId,
        set: { capitalGrantPolicy: policy, updatedBy: meta.actorId, updatedAt: new Date(), version: sql`${financeSettings.version} + 1` },
      });
  } catch (err) {
    const text = [(err as { message?: string })?.message, (err as { cause?: { message?: string } })?.cause?.message].filter(Boolean).join(" ");
    if (text.includes("GRANT_POLICY_LOCKED")) throw new DomainError("GRANT_POLICY_LOCKED", text.slice(text.indexOf("GRANT_POLICY_LOCKED")));
    throw err;
  }
  await auditEvent(tx, meta, "set_capital_grant_policy", "finance_settings", meta.tenantId, { capitalGrantPolicy: policy, reason });
}
