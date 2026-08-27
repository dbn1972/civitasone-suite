import { eq, and, isNull, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { fileShares, type ShareRow, type ShareInsert } from "./schema.js";

export async function listByFile(tenantId: string, fileId: string): Promise<ShareRow[]> {
  return scopedRead((tx) =>
    tx.select().from(fileShares).where(and(eq(fileShares.tenantId, tenantId), eq(fileShares.fileId, fileId), isNull(fileShares.revokedAt)))
  );
}

export async function listSharedWithUser(tenantId: string, userId: string): Promise<ShareRow[]> {
  return scopedRead((tx) =>
    tx.select().from(fileShares).where(and(eq(fileShares.tenantId, tenantId), eq(fileShares.sharedWith, userId), isNull(fileShares.revokedAt))).orderBy(desc(fileShares.createdAt))
  );
}

export type Writer = Pick<typeof db, "insert" | "update">;

export async function insert(tx: Writer, row: ShareInsert): Promise<void> {
  await tx.insert(fileShares).values(row);
}

export async function revoke(tx: Writer, tenantId: string, id: string, actorId: string): Promise<void> {
  await tx.update(fileShares).set({ revokedAt: new Date() })
    .where(and(eq(fileShares.tenantId, tenantId), eq(fileShares.id, id)));
}
