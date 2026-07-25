import { eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { vaptScans, securityIncidents } from "./schema.js";

export async function listScans(tenantId: string) {
  return db.select().from(vaptScans).where(eq(vaptScans.tenantId, tenantId)).orderBy(desc(vaptScans.createdAt)).limit(50);
}
export async function findScan(id: string) {
  const rows = await db.select().from(vaptScans).where(eq(vaptScans.id, id)).limit(1);
  return rows[0];
}
export async function listIncidents(tenantId: string) {
  return db.select().from(securityIncidents).where(eq(securityIncidents.tenantId, tenantId)).orderBy(desc(securityIncidents.detectedAt)).limit(100);
}
export async function findIncident(id: string) {
  const rows = await db.select().from(securityIncidents).where(eq(securityIncidents.id, id)).limit(1);
  return rows[0];
}
