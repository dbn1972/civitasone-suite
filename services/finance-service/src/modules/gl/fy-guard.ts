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
  const { fy, status } = await fiscalYearStatus(tenantId, date);
  if (status === "draft") {
    throw new HttpError(422, "FY_NOT_ACTIVE", `financial year ${fy} has not been activated; postings dated ${date} cannot be accepted until it is`, [
      { field, message: "This date is in a financial year that is not active yet. Choose a date in the active year, or ask the finance admin to activate the year." },
    ]);
  }
}
