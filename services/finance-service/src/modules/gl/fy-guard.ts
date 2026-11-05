/**
 * UAT T-PERIOD D-07: a posting may not land in a financial year that exists but has not been activated (status draft).
 * The posting consumer (gl/consumer.ts postJournal) is the authority; the routes use the synchronous form so the officer
 * gets a 422 FY_NOT_ACTIVE at once. A financial year with no row at all is left to the period rules.
 */
import { sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { fyOfDate } from "../../shared/ist-date.js";

export async function fiscalYearStatus(tenantId: string, date: string): Promise<{ fy: string; status: string | null }> {
  const fy = fyOfDate(date);
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT status FROM gl.finance_fiscal_years WHERE tenant_id = ${tenantId}::uuid AND code = ${fy} LIMIT 1
  `))) as unknown as Array<{ status: string }>;
  return { fy, status: rows[0]?.status ?? null };
}

export async function assertFiscalYearActiveHttp(tenantId: string, date: string, field = "postingDate"): Promise<void> {
  await assertFiscalYearNotClosedHttp(tenantId, date, field);
  const { fy, status } = await fiscalYearStatus(tenantId, date);
  if (status === "draft") {
    throw new HttpError(422, "FY_NOT_ACTIVE", `financial year ${fy} has not been activated; postings dated ${date} cannot be accepted until it is`, [
      { field, message: "This date is in a financial year that is not active yet. Choose a date in the active year, or ask the finance admin to activate the year." },
    ]);
  }
}

/**
 * UAT T-PERIOD review (blocker 1): a financial year whose accounts are closed -- gl.finance_fiscal_years status closed, or
 * a year-end close has run for it (gl.finance_year_end_runs) -- takes no reopen and no posting: the next year opening
 * balances were generated from it. Corrections are prior-period adjustments in the open year. Returns the reason, or
 * null when the year is not closed. Runs in the caller transaction.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fyClosedReasonTx(tx: any, tenantId: string, fy: string): Promise<string | null> {
  const raw = await tx.execute(sql`
    SELECT (SELECT status FROM gl.finance_fiscal_years WHERE tenant_id = ${tenantId}::uuid AND code = ${fy} LIMIT 1) AS status,
           EXISTS (SELECT 1 FROM gl.finance_year_end_runs WHERE tenant_id = ${tenantId}::uuid AND fy_code = ${fy}) AS ran
  `);
  const r = ((Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] } | undefined)?.rows ?? [])) as Array<{ status: string | null; ran: boolean }>)[0];
  if (r?.ran) return `financial year ${fy} is closed: its year-end close has run`;
  if (r?.status === "closed") return `financial year ${fy} is closed`;
  return null;
}

export function fyClosedMessage(reason: string, what: string): string {
  return `${reason}; ${what} cannot be reopened or posted to -- make the correction as a prior-period adjustment in the open year`;
}

/** HTTP form: 409 FY_CLOSED for a date in a closed financial year. */
export async function assertFiscalYearNotClosedHttp(tenantId: string, date: string, field = "postingDate"): Promise<void> {
  const fy = fyOfDate(date);
  const reason = await scopedRead((tx) => fyClosedReasonTx(tx, tenantId, fy));
  if (reason) {
    throw new HttpError(409, "FY_CLOSED", fyClosedMessage(reason, date), [
      { field, message: "This date is in a closed financial year. Make the correction as a prior-period adjustment in the open year." },
    ]);
  }
}
