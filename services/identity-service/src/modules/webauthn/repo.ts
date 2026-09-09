import { and, eq } from "drizzle-orm";
import { db, scopedRead, type Db } from "../../shared/db.js";
import { webauthnCredentials, type WebauthnCredentialRow, type WebauthnCredentialInsert } from "./schema.js";

export type Writer = Pick<Db, "insert" | "update" | "delete" | "select">;

export async function listByOwner(tenantId: string, userId: string): Promise<WebauthnCredentialRow[]> {
  return scopedRead((tx) =>
    tx.select().from(webauthnCredentials)
      .where(and(eq(webauthnCredentials.tenantId, tenantId), eq(webauthnCredentials.userId, userId))),
  );
}

export async function findById(tenantId: string, id: string): Promise<WebauthnCredentialRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(webauthnCredentials)
      .where(and(eq(webauthnCredentials.tenantId, tenantId), eq(webauthnCredentials.id, id)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function insert(row: WebauthnCredentialInsert): Promise<WebauthnCredentialRow> {
  return db.transaction(async (tx) => {
    const rows = await tx.insert(webauthnCredentials).values(row).returning();
    const saved = rows[0];
    if (!saved) throw new Error("webauthn credential insert did not persist");
    return saved;
  });
}

/**
 * Delete a credential, scoped to BOTH tenant and owner (userId). The
 * ownership predicate lives in the WHERE clause, not in application logic
 * that could be bypassed — a delete for a credential owned by someone else
 * (or in another tenant) matches zero rows and returns 0, never throws, and
 * never touches another user's row.
 *
 * Returns the number of rows actually deleted (0 or 1).
 */
export async function deleteByIdForOwner(tenantId: string, id: string, userId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const result = await tx.delete(webauthnCredentials)
      .where(and(
        eq(webauthnCredentials.tenantId, tenantId),
        eq(webauthnCredentials.id, id),
        eq(webauthnCredentials.userId, userId),
      ))
      .returning({ id: webauthnCredentials.id });
    return result.length;
  });
}
