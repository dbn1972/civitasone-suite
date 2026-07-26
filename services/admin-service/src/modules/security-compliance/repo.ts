import { and, eq, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { vaptScans, securityIncidents, complianceControls, controlEvidence } from "./schema.js";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function listScans(tenantId: string) {
  return scopedRead((tx) => tx.select().from(vaptScans).where(eq(vaptScans.tenantId, tenantId)).orderBy(desc(vaptScans.createdAt)).limit(50));
}
export function findScan(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(vaptScans).where(and(eq(vaptScans.tenantId, tenantId), eq(vaptScans.id, id))).limit(1);
    return rows[0];
  });
}
export function listIncidents(tenantId: string) {
  return scopedRead((tx) => tx.select().from(securityIncidents).where(eq(securityIncidents.tenantId, tenantId)).orderBy(desc(securityIncidents.detectedAt)).limit(100));
}

// ── CAP-089 control library ──────────────────────────────────────────
export function listControls(tenantId: string, framework?: string) {
  return scopedRead((tx) => {
    const where = framework
      ? and(eq(complianceControls.tenantId, tenantId), eq(complianceControls.framework, framework))
      : eq(complianceControls.tenantId, tenantId);
    return tx.select().from(complianceControls).where(where).orderBy(complianceControls.framework, complianceControls.controlKey);
  });
}
export function findControl(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(complianceControls).where(and(eq(complianceControls.tenantId, tenantId), eq(complianceControls.id, id))).limit(1);
    return rows[0];
  });
}
export async function findControlTx(tx: Tx, tenantId: string, id: string) {
  const rows = await tx.select().from(complianceControls).where(and(eq(complianceControls.tenantId, tenantId), eq(complianceControls.id, id))).limit(1);
  return rows[0];
}
export function evidenceFor(tenantId: string, controlId: string) {
  return scopedRead((tx) => tx.select().from(controlEvidence).where(and(eq(controlEvidence.tenantId, tenantId), eq(controlEvidence.controlId, controlId))).orderBy(desc(controlEvidence.collectedAt)));
}
