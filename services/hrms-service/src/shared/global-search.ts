/**
 * HRMS -> cross-module search (employees). DATA MINIMISATION IS THE POINT HERE: the column list below names exactly
 * four data columns (name, employee number, status, engagement type) plus the keys. Salary/CTC, PAN, Aadhaar, bank,
 * mobile, e-mail, date of birth, address, department/designation and every other column are never read by this code
 * path, so they cannot be indexed. Flag off for the tenant => returns before any query.
 */
import { and, asc, eq, gt } from "drizzle-orm";
import { syncGlobalRecord, type BackfillEntity, type DrizzleTx, type SearchableFields } from "@civitasone/search";
import { hrmsEmployees } from "../modules/employee/schema.js";
import type { db } from "./db.js";

type Reader = Pick<typeof db, "select">;

const employeeCols = {
  id: hrmsEmployees.id, tenantId: hrmsEmployees.tenantId, updatedBy: hrmsEmployees.updatedBy, employeeNo: hrmsEmployees.employeeNo,
  fullName: hrmsEmployees.fullName, status: hrmsEmployees.status, employeeType: hrmsEmployees.employeeType,
};
const employeeFields = (r: { employeeNo: string; fullName: string; status: string; employeeType: string }): SearchableFields => ({
  title: r.fullName, refNumber: r.employeeNo, status: r.status, summary: r.employeeType,
});

export async function syncEmployee(tx: Reader, id: string, tenantId?: string): Promise<void> {
  await syncGlobalRecord({
    tx: tx as unknown as DrizzleTx, entityType: "hrms.employee", entityId: id, tenantId,
    load: async () => (await tx.select(employeeCols).from(hrmsEmployees)
      .where(tenantId ? and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId)) : eq(hrmsEmployees.id, id)).limit(1))[0],
    toRecord: employeeFields,
  });
}

/** Backfill source (keyset on id). `withTenant` must run `fn` in a transaction that carries the tenant GUC (RLS). */
export function backfillEntities(tenantId: string, withTenant: <T>(fn: (tx: Reader) => Promise<T>) => Promise<T>): BackfillEntity[] {
  return [{
    entityType: "hrms.employee",
    source: {
      tenantId, idOf: (r: { id: string }) => r.id,
      fetchPage: (after: string | null, size: number) => withTenant((tx) => tx.select(employeeCols).from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.tenantId, tenantId), after ? gt(hrmsEmployees.id, after) : undefined)).orderBy(asc(hrmsEmployees.id)).limit(size)),
      toRecord: (r: Parameters<typeof employeeFields>[0] & { id: string }) => ({ ...employeeFields(r), entityType: "hrms.employee" as const, entityId: r.id, tenantId }),
    },
  }];
}
