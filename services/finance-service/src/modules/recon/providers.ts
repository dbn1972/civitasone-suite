/**
 * CAP-059 — reconciliation source providers.
 *
 * A provider pulls two INDEPENDENT datasets (a "source" and a "target") that
 * ought to agree, plus the ReconConfig describing how to align + compare them.
 * The recon service feeds these into the @civitasone/reconciliation engine.
 *
 * Providers are the extension point: register more (GL vs subledger, PFMS vs
 * ledger, ...) without touching the run/exception machinery. One concrete
 * provider is wired here as proof — book payments vs bank statement lines, the
 * canonical bank reconciliation.
 */
import { and, eq, isNotNull, ne } from "drizzle-orm";
import type { ReconConfig, ReconRecord } from "@civitasone/reconciliation";
import { scopedRead } from "../../shared/db.js";
import { financePayments } from "../payments/schema.js";
import { bankStatementLines } from "../bank-recon/schema.js";

export interface ReconSourceData {
  source: ReconRecord[];
  target: ReconRecord[];
  config: ReconConfig;
}

export interface ReconProvider {
  key: string;
  sourceSystem: string;
  targetSystem: string;
  /** Pull both sides for a tenant. `params` is provider-specific (validated by caller). */
  fetch(tenantId: string, params: Record<string, unknown>): Promise<ReconSourceData>;
}

/**
 * book-vs-bank: reconcile the municipality's own payment register (book side,
 * keyed by UTR) against the bank's statement debit lines (bank side, keyed by
 * reference). A payment with no matching bank line, a bank line with no
 * matching payment, or an amount that differs each produce a break.
 */
export const bookVsBankProvider: ReconProvider = {
  key: "book-vs-bank",
  sourceSystem: "finance-book",
  targetSystem: "bank-statement",
  async fetch(tenantId, params) {
    const bankAccountId = typeof params.bankAccountId === "string" ? params.bankAccountId : undefined;

    const payments = await scopedRead((tx) =>
      tx
        .select({ utr: financePayments.utr, amountMinor: financePayments.amountMinor })
        .from(financePayments)
        .where(
          and(
            eq(financePayments.tenantId, tenantId),
            isNotNull(financePayments.utr),
            ne(financePayments.utr, ""),
            ...(bankAccountId ? [eq(financePayments.bankAccountId, bankAccountId)] : []),
          ),
        )
        .limit(5000),
    );

    const lines = await scopedRead((tx) =>
      tx
        .select({ reference: bankStatementLines.reference, amountMinor: bankStatementLines.amountMinor })
        .from(bankStatementLines)
        .where(
          and(
            eq(bankStatementLines.tenantId, tenantId),
            eq(bankStatementLines.direction, "debit"),
            isNotNull(bankStatementLines.reference),
            ne(bankStatementLines.reference, ""),
          ),
        )
        .limit(5000),
    );

    const source: ReconRecord[] = payments.map((p) => ({
      key: String(p.utr),
      amountMinor: p.amountMinor,
    }));
    const target: ReconRecord[] = lines.map((l) => ({
      key: String(l.reference),
      amountMinor: l.amountMinor,
    }));

    const config: ReconConfig = {
      keyField: "key",
      sourceSystem: this.sourceSystem,
      targetSystem: this.targetSystem,
      fields: [{ field: "amountMinor", type: "amount", tolerance: 0 }],
    };

    return { source, target, config };
  },
};

const REGISTRY = new Map<string, ReconProvider>([[bookVsBankProvider.key, bookVsBankProvider]]);

export function getProvider(key: string): ReconProvider | undefined {
  return REGISTRY.get(key);
}

export function listProviders(): ReconProvider[] {
  return [...REGISTRY.values()];
}

/** Test/extension hook — register an additional provider. */
export function registerProvider(p: ReconProvider): void {
  REGISTRY.set(p.key, p);
}
