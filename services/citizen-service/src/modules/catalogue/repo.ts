import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  serviceDefinitions,
  type ServiceDefinitionRow, type ServiceDefinitionInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertDefinition(tx: Writer, row: ServiceDefinitionInsert): Promise<void> {
  await tx.insert(serviceDefinitions).values(row);
}

export async function findDefinitionByIdTx(tx: Writer, id: string, tenantId: string): Promise<ServiceDefinitionRow | null> {
  const rows = await (tx as typeof db).select().from(serviceDefinitions)
    .where(and(eq(serviceDefinitions.id, id), eq(serviceDefinitions.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findDefinitionById(id: string, tenantId: string): Promise<ServiceDefinitionRow | null> {
  return db.transaction((tx) => findDefinitionByIdTx(tx, id, tenantId));
}

/** Latest version number for a (tenant, service_key) or 0 when none exist. */
export async function latestVersionForKey(tx: Writer, tenantId: string, serviceKey: string): Promise<number> {
  const rows = await (tx as typeof db).select().from(serviceDefinitions)
    .where(and(eq(serviceDefinitions.tenantId, tenantId), eq(serviceDefinitions.serviceKey, serviceKey)))
    .orderBy(desc(serviceDefinitions.version)).limit(1);
  return rows[0]?.version ?? 0;
}

export async function updateDefinition(tx: Writer, id: string, tenantId: string, patch: Partial<ServiceDefinitionInsert>): Promise<void> {
  await tx.update(serviceDefinitions).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(serviceDefinitions.id, id), eq(serviceDefinitions.tenantId, tenantId)));
}

export async function listDefinitions(tenantId: string, limit = 200): Promise<ServiceDefinitionRow[]> {
  return db.transaction((tx) => tx.select().from(serviceDefinitions)
    .where(eq(serviceDefinitions.tenantId, tenantId))
    .orderBy(desc(serviceDefinitions.createdAt)).limit(limit));
}

/** Latest PUBLISHED definition for a service_key (the citizen-facing view). */
export async function findPublishedByKeyTx(tx: Writer, tenantId: string, serviceKey: string): Promise<ServiceDefinitionRow | null> {
  const rows = await (tx as typeof db).select().from(serviceDefinitions)
    .where(and(
      eq(serviceDefinitions.tenantId, tenantId),
      eq(serviceDefinitions.serviceKey, serviceKey),
      eq(serviceDefinitions.status, "published"),
    ))
    .orderBy(desc(serviceDefinitions.version)).limit(1);
  return rows[0] ?? null;
}

export async function findPublishedByKey(tenantId: string, serviceKey: string): Promise<ServiceDefinitionRow | null> {
  return db.transaction((tx) => findPublishedByKeyTx(tx, tenantId, serviceKey));
}

/** Latest PUBLISHED definition linked to a portal service_id (checklist lookup). */
export async function findPublishedByServiceIdTx(tx: Writer, tenantId: string, serviceId: string): Promise<ServiceDefinitionRow | null> {
  const rows = await (tx as typeof db).select().from(serviceDefinitions)
    .where(and(
      eq(serviceDefinitions.tenantId, tenantId),
      eq(serviceDefinitions.serviceId, serviceId),
      eq(serviceDefinitions.status, "published"),
    ))
    .orderBy(desc(serviceDefinitions.version)).limit(1);
  return rows[0] ?? null;
}

export async function findPublishedByServiceId(tenantId: string, serviceId: string): Promise<ServiceDefinitionRow | null> {
  return db.transaction((tx) => findPublishedByServiceIdTx(tx, tenantId, serviceId));
}

export async function listPublished(tenantId: string, limit = 200): Promise<ServiceDefinitionRow[]> {
  return db.transaction((tx) => tx.select().from(serviceDefinitions)
    .where(and(eq(serviceDefinitions.tenantId, tenantId), eq(serviceDefinitions.status, "published")))
    .orderBy(desc(serviceDefinitions.version)).limit(limit));
}
