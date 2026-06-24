import { sql, type SQL } from "drizzle-orm";

/** Minimal executor surface — satisfied by the drizzle db or a transaction. */
type Executor = { execute: (query: SQL) => Promise<unknown> };

export type CashBookEntry = {
  tenantId: string;
  entryDate: string;             // YYYY-MM-DD
  voucherType: "receipt" | "payment" | "contra" | "journal" | "debit_note" | "credit_note";
  voucherNo: string;
  particulars: string;
  /** PAISE bigint. Exactly one of receiptMinor / paymentMinor is non-zero. */
  receiptMinor: bigint;
  paymentMinor: bigint;
  bankOrCash: "cash" | "bank";
  reference: string;             // source key, e.g. "payment:<uuid>" — drives idempotency
  actorId: string;
};

/**
 * Append a cash-book row (IGFRS cash basis) with a correct running balance,
 * inside the SAME tx as the business write.
 *
 * Running balance is computed in-SQL from the prior balance for the same
 * (tenant, bankOrCash) stream so concurrent writers serialise on the row lock
 * the surrounding GL/payment tx already holds. Money is PAISE bigint end to end
 * — amounts are passed as decimal strings and cast to bigint in SQL (never
 * Number() on aggregate paise).
 *
 * Idempotent: a partial unique index on (tenant_id, reference) plus
 * ON CONFLICT DO NOTHING makes a redelivered payment/challan a no-op.
 */
export async function postCashBook(tx: Executor, e: CashBookEntry): Promise<void> {
  const receipt = e.receiptMinor.toString();
  const payment = e.paymentMinor.toString();
  // C3: serialise the per-(tenant, bank_or_cash) running-balance stream with a
  // transaction-scoped advisory lock so two concurrent payments on the same
  // stream cannot both read the same prior balance (lost update). The lock is
  // released automatically at tx commit/rollback. hashtextextended -> bigint so
  // it fits pg_advisory_xact_lock(bigint).
  const streamKey = `cashbook:${e.tenantId}:${e.bankOrCash}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${streamKey}, 0))`);
  await tx.execute(sql`
    INSERT INTO gl.finance_cash_book
      (tenant_id, entry_date, voucher_type, voucher_no, particulars,
       receipt_minor, payment_minor, balance_minor, bank_or_cash, reference)
    SELECT
      ${e.tenantId}::uuid, ${e.entryDate}::date, ${e.voucherType}, ${e.voucherNo},
      ${e.particulars}, ${receipt}::bigint, ${payment}::bigint,
      COALESCE((
        SELECT cb.balance_minor
        FROM gl.finance_cash_book cb
        WHERE cb.tenant_id = ${e.tenantId}::uuid
          AND cb.bank_or_cash = ${e.bankOrCash}
        ORDER BY cb.entry_date DESC, cb.created_at DESC
        LIMIT 1
      ), 0) + ${receipt}::bigint - ${payment}::bigint,
      ${e.bankOrCash}, ${e.reference}
    ON CONFLICT (tenant_id, reference) WHERE reference IS NOT NULL DO NOTHING
  `);
}
