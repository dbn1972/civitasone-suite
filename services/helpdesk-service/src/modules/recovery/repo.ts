import { eq, and, asc } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { recoveryPolicies, recoveryActions } from "./schema.js";
import type { RecoveryPolicyRow, RecoveryActionRow } from "./schema.js";

const CACHE_PREFIX = "helpdesk:recovery";

export async function getActivePolicies(tenantId: string): Promise<RecoveryPolicyRow[]> {
  const result = await cache.getOrLoad<RecoveryPolicyRow[]>(
    `${CACHE_PREFIX}:policies:${tenantId}`,
    async () => {
      return db.transaction((tx) =>
        tx.select().from(recoveryPolicies)
          .where(and(eq(recoveryPolicies.tenantId, tenantId), eq(recoveryPolicies.active, true)))
          .orderBy(asc(recoveryPolicies.createdAt)),
      );
    },
  );
  return result ?? [];
}

export async function getPolicyById(tenantId: string, id: string): Promise<RecoveryPolicyRow | null> {
  const [row] = await db.transaction((tx) =>
    tx.select().from(recoveryPolicies)
      .where(and(eq(recoveryPolicies.id, id), eq(recoveryPolicies.tenantId, tenantId)))
      .limit(1),
  );
  return row ?? null;
}

export async function getActionsByTicket(tenantId: string, ticketId: string): Promise<RecoveryActionRow[]> {
  return db.transaction((tx) =>
    tx.select().from(recoveryActions)
      .where(and(eq(recoveryActions.tenantId, tenantId), eq(recoveryActions.ticketId, ticketId)))
      .orderBy(asc(recoveryActions.createdAt)),
  );
}

export async function getActionById(tenantId: string, id: string): Promise<RecoveryActionRow | null> {
  const [row] = await db.transaction((tx) =>
    tx.select().from(recoveryActions)
      .where(and(eq(recoveryActions.id, id), eq(recoveryActions.tenantId, tenantId)))
      .limit(1),
  );
  return row ?? null;
}
