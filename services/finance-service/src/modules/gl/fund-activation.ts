/**
 * Section 8 NF-1: the one place that switches fund accounting on (or tries to switch it off).
 *
 * gl.finance_settings.fund_accounting has no route that edits it yet (the NF-8 activation wizard will call this); nothing
 * materialises it today. Turning it ON creates the tenant's GENERAL (unrestricted) fund in the SAME transaction. The rules
 * are enforced by the database trigger gl.guard_fund_accounting_flip (migration 0171), which cannot be bypassed:
 *  - a flip is refused while manual journals are pending approval (their fund state would be ambiguous: S5);
 *  - turning OFF is refused once any fund-tagged ledger row exists (the ledger is append-only: irreversible).
 * This wrapper turns those database refusals into DomainErrors and checks the pending drafts first for a clean message.
 */
import { and, eq, sql } from "drizzle-orm";
import { financeSettings } from "../approvals/schema.js";
import { DomainError } from "../approvals/domain.js";
import { auditEvent, type ActorMeta, type Tx } from "../approvals/apply.js";
import { financeJournals } from "./schema.js";
import { ensureGeneralFundTx } from "./funds.js";

const FLIP_CODES = ["FUND_ACCOUNTING_FLIP_PENDING_DRAFTS", "FUND_ACCOUNTING_IRREVERSIBLE"] as const;

function asFlipError(err: unknown): never {
  const text = [(err as { message?: string })?.message, (err as { cause?: { message?: string } })?.cause?.message].filter(Boolean).join(" ");
  const code = FLIP_CODES.find((c) => text.includes(c));
  if (code) throw new DomainError(code, text.slice(text.indexOf(code)));
  throw err;
}

export async function setFundAccountingTx(tx: Tx, meta: ActorMeta, on: boolean, reason: string): Promise<{ generalFundId: string | null }> {
  const pending = await tx.select({ id: financeJournals.id }).from(financeJournals)
    .where(and(eq(financeJournals.tenantId, meta.tenantId), eq(financeJournals.status, "pending_approval"))).limit(1);
  if (pending.length > 0) {
    throw new DomainError("FUND_ACCOUNTING_FLIP_PENDING_DRAFTS", "fund accounting cannot be switched while manual journals are pending approval; approve or reject them first");
  }
  try {
    const generalFundId = on ? await ensureGeneralFundTx(tx, meta.tenantId, meta.actorId) : null;
    await tx.insert(financeSettings).values({ tenantId: meta.tenantId, fundAccounting: on, updatedBy: meta.actorId })
      .onConflictDoUpdate({
        target: financeSettings.tenantId,
        set: { fundAccounting: on, updatedBy: meta.actorId, updatedAt: new Date(), version: sql`${financeSettings.version} + 1` },
      });
    await auditEvent(tx, meta, "set_fund_accounting", "finance_settings", meta.tenantId, { fundAccounting: on, reason });
    return { generalFundId };
  } catch (err) {
    return asFlipError(err);
  }
}
