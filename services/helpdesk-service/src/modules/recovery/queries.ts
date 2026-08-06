import { eq, and, asc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { recoveryPolicies, recoveryActions } from "./schema.js";

export async function listPolicies(tenantId: string, limit: number, offset: number) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(recoveryPolicies)
      .where(eq(recoveryPolicies.tenantId, tenantId))
      .orderBy(asc(recoveryPolicies.createdAt))
      .limit(limit)
      .offset(offset);

    const [countRow] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(recoveryPolicies)
      .where(eq(recoveryPolicies.tenantId, tenantId));

    return { rows, total: countRow?.total ?? 0 };
  });
}

export async function listActionsByTicket(tenantId: string, ticketId: string, limit: number, offset: number) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(recoveryActions)
      .where(and(eq(recoveryActions.tenantId, tenantId), eq(recoveryActions.ticketId, ticketId)))
      .orderBy(asc(recoveryActions.createdAt))
      .limit(limit)
      .offset(offset);

    const [countRow] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(recoveryActions)
      .where(and(eq(recoveryActions.tenantId, tenantId), eq(recoveryActions.ticketId, ticketId)));

    return { rows, total: countRow?.total ?? 0 };
  });
}
