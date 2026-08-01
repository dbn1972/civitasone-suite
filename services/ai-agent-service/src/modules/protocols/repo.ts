/**
 * protocols/repo.ts — DB operations for AG-005 protocol registrations.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import {
  protocolRegistrations,
  type ProtocolRegistrationRow,
  type ProtocolRegistrationInsert,
} from "./schema.js";

export function toView(r: ProtocolRegistrationRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    protocol: r.protocol,
    endpoint: r.endpoint,
    capabilities: r.capabilities,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type ProtocolRegistrationView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<ProtocolRegistrationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(protocolRegistrations)
      .where(and(eq(protocolRegistrations.id, id), eq(protocolRegistrations.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  protocol?: string;
  enabled?: boolean;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: ProtocolRegistrationRow[]; total: number }> {
  const conditions: SQL[] = [eq(protocolRegistrations.tenantId, tenantId)];
  if (filters.protocol) conditions.push(eq(protocolRegistrations.protocol, filters.protocol));
  if (filters.enabled !== undefined) conditions.push(eq(protocolRegistrations.enabled, filters.enabled));
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(protocolRegistrations)
      .where(where)
      .orderBy(desc(protocolRegistrations.updatedAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(protocolRegistrations).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: ProtocolRegistrationInsert): Promise<void> {
  await tx.insert(protocolRegistrations).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<ProtocolRegistrationInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(protocolRegistrations)
    .set({ ...patch, updatedAt: new Date(), version: sql`${protocolRegistrations.version} + 1` })
    .where(and(
      eq(protocolRegistrations.id, id),
      eq(protocolRegistrations.tenantId, tenantId),
      eq(protocolRegistrations.version, currentVersion),
    ))
    .returning({ id: protocolRegistrations.id });
  return result.length > 0;
}
