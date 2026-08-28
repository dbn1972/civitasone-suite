import { eq, and } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsEmployees, type EmployeeRow, type EmployeeInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findById(id: string, tenantId: string): Promise<EmployeeRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

export async function findByNo(employeeNo: string, tenantId: string): Promise<EmployeeRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.employeeNo, employeeNo), eq(hrmsEmployees.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit = 100, offset = 0, employeeType?: string): Promise<EmployeeRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(employeeType
      ? and(eq(hrmsEmployees.tenantId, tenantId), eq(hrmsEmployees.employeeType, employeeType))
      : eq(hrmsEmployees.tenantId, tenantId))
    .limit(limit)
    .offset(offset));
}

export async function insertEmployee(tx: Writer, row: EmployeeInsert): Promise<void> {
  await tx.insert(hrmsEmployees).values(row);
}

export async function updateEmployee(tx: Writer, id: string, patch: Partial<EmployeeInsert>): Promise<void> {
  await tx.update(hrmsEmployees).set({ ...patch, updatedAt: new Date() }).where(eq(hrmsEmployees.id, id));
}
