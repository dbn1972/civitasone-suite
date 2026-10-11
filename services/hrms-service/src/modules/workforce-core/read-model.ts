/**
 * Workforce Core — tenure / posting read models (SmartTransfer OS, ST-M01-07).
 *
 * Thin, typed wrappers over the SQL read model shipped in migration
 * `0201_workforce_core.sql`:
 *   • workforce_core.service_tenure_days(employee, as_of)
 *   • workforce_core.current_station_tenure_days(employee, as_of)
 *   • workforce_core.v_current_posting
 *
 * These are READS only. Every read runs inside the tenant transaction
 * (`scopedRead`), so PostgreSQL RLS on the underlying tables is enforced on the
 * read path too — a NOBYPASSRLS role with no app.tenant_id GUC set sees zero
 * rows (see src/shared/db.ts scopedRead doc). ST-M01-07 adds no write path; the
 * single `applyPosting` writer and the posting events are ST-M01-09.
 */
import { sql } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return Array.from(result as Iterable<Record<string, unknown>>);
}

/**
 * Total days an employee has held SUBSTANTIVE postings up to `asOf`, derived
 * from the append-only posting ledger. Returns 0 when there is no history.
 */
export async function serviceTenureDays(
  employeeId: string,
  asOf: string,
): Promise<number> {
  return scopedRead(async (tx: ScopedTx) => {
    const res = await (tx as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(
      sql`SELECT workforce_core.service_tenure_days(${employeeId}::uuid, ${asOf}::date) AS days`,
    );
    const [row] = rowsOf(res);
    return Number(row?.days ?? 0);
  });
}

/**
 * Days in the employee's CURRENT (latest) substantive posting as of `asOf` —
 * the "tenure at station" an eligibility rule typically needs. Returns 0 when
 * there is no current substantive posting.
 */
export async function currentStationTenureDays(
  employeeId: string,
  asOf: string,
): Promise<number> {
  return scopedRead(async (tx: ScopedTx) => {
    const res = await (tx as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(
      sql`SELECT workforce_core.current_station_tenure_days(${employeeId}::uuid, ${asOf}::date) AS days`,
    );
    const [row] = rowsOf(res);
    return Number(row?.days ?? 0);
  });
}

export interface CurrentPosting {
  employeeId: string;
  officeId: string;
  postId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  orderRef: string | null;
  stationTenureDays: number;
}

/** The current (open or latest) substantive posting for an employee, or null. */
export async function currentPosting(
  employeeId: string,
): Promise<CurrentPosting | null> {
  return scopedRead(async (tx: ScopedTx) => {
    const res = await (tx as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(
      sql`SELECT employee_id, office_id, post_id, effective_from, effective_to,
                 order_ref, station_tenure_days
            FROM workforce_core.v_current_posting
           WHERE employee_id = ${employeeId}::uuid`,
    );
    const [row] = rowsOf(res);
    if (!row) return null;
    return {
      employeeId: String(row.employee_id),
      officeId: String(row.office_id),
      postId: row.post_id === null ? null : String(row.post_id),
      effectiveFrom: String(row.effective_from),
      effectiveTo: row.effective_to === null ? null : String(row.effective_to),
      orderRef: row.order_ref === null ? null : String(row.order_ref),
      stationTenureDays: Number(row.station_tenure_days ?? 0),
    };
  });
}
