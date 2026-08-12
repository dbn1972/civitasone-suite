import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabLeaseProperties, estabLeases, estabLeasePayments, estabLeaseRequests } from "./schema.js";

export async function listProperties(tenantId: string, q: { status?: string | undefined }): Promise<unknown[]> {
  if (q.status) {
    return db.select().from(estabLeaseProperties)
      .where(and(eq(estabLeaseProperties.tenantId, tenantId), eq(estabLeaseProperties.status, q.status)));
  }
  return db.select().from(estabLeaseProperties).where(eq(estabLeaseProperties.tenantId, tenantId));
}

export async function getProperty(tenantId: string, id: string): Promise<unknown | undefined> {
  const rows = await db.select().from(estabLeaseProperties)
    .where(and(eq(estabLeaseProperties.tenantId, tenantId), eq(estabLeaseProperties.id, id)))
    .limit(1);
  return rows[0];
}

export async function listLeases(tenantId: string, q: { status?: string | undefined }): Promise<unknown[]> {
  if (q.status) {
    return db.select().from(estabLeases)
      .where(and(eq(estabLeases.tenantId, tenantId), eq(estabLeases.status, q.status)));
  }
  return db.select().from(estabLeases).where(eq(estabLeases.tenantId, tenantId));
}

export async function getLease(tenantId: string, id: string): Promise<unknown | undefined> {
  const rows = await db.select().from(estabLeases)
    .where(and(eq(estabLeases.tenantId, tenantId), eq(estabLeases.id, id)))
    .limit(1);
  return rows[0];
}

export async function listLeasePayments(tenantId: string, leaseId: string): Promise<unknown[]> {
  return db.select().from(estabLeasePayments)
    .where(and(eq(estabLeasePayments.tenantId, tenantId), eq(estabLeasePayments.leaseId, leaseId)));
}

export async function listRequests(tenantId: string, q: { status?: string | undefined }): Promise<unknown[]> {
  if (q.status) {
    return db.select().from(estabLeaseRequests)
      .where(and(eq(estabLeaseRequests.tenantId, tenantId), eq(estabLeaseRequests.status, q.status)));
  }
  return db.select().from(estabLeaseRequests).where(eq(estabLeaseRequests.tenantId, tenantId));
}

export async function getRequest(tenantId: string, id: string): Promise<unknown | undefined> {
  const rows = await db.select().from(estabLeaseRequests)
    .where(and(eq(estabLeaseRequests.tenantId, tenantId), eq(estabLeaseRequests.id, id)))
    .limit(1);
  return rows[0];
}
