import { eq, and, desc, isNull } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cases, caseDeviations } from "./schema.js";

export async function listCases(tenantId: string, limit = 100) {
  return db.select().from(cases).where(and(eq(cases.tenantId, tenantId), isNull(cases.mergedIntoCaseId))).orderBy(desc(cases.createdAt)).limit(limit);
}
export async function findCase(tenantId: string, id: string) {
  const rows = await db.select().from(cases).where(and(eq(cases.id, id), eq(cases.tenantId, tenantId))).limit(1);
  return rows[0];
}
export async function findChildren(tenantId: string, parentId: string) {
  return db.select().from(cases).where(and(eq(cases.tenantId, tenantId), eq(cases.parentCaseId, parentId)));
}
export async function listDeviations(tenantId: string, caseId: string) {
  return db.select().from(caseDeviations).where(and(eq(caseDeviations.tenantId, tenantId), eq(caseDeviations.caseId, caseId))).orderBy(desc(caseDeviations.createdAt));
}
