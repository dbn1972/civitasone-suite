import { randomUUID } from "node:crypto";
import { and, eq, asc, isNull } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { entityComments, type CommentRow } from "./schema.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function withTx<T>(outer: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (outer) return fn(outer);
  return db.transaction(fn);
}

export async function find(tenantId: string, id: string): Promise<CommentRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(entityComments)
    .where(and(eq(entityComments.tenantId, tenantId), eq(entityComments.id, id))).limit(1));
  return rows[0];
}

/** Live (non-deleted) comments for an entity, oldest first. */
export async function listForEntity(tenantId: string, entityType: string, entityId: string): Promise<CommentRow[]> {
  return scopedRead((tx) => tx.select().from(entityComments)
    .where(and(
      eq(entityComments.tenantId, tenantId),
      eq(entityComments.entityType, entityType),
      eq(entityComments.entityId, entityId),
      isNull(entityComments.deletedAt),
    ))
    .orderBy(asc(entityComments.createdAt)));
}

export interface AddInput {
  tenantId: string; entityType: string; entityId: string; parentCommentId?: string | null | undefined;
  body: string; visibility: "internal" | "external"; actorId: string;
}

export async function add(input: AddInput & { id?: string }, outer?: Tx): Promise<CommentRow> {
  const id = input.id ?? randomUUID();
  return withTx(outer, async (tx) => {
    // A reply must target a live comment on the SAME entity (tenant-scoped).
    if (input.parentCommentId) {
      const parent = await tx.select({ id: entityComments.id }).from(entityComments)
        .where(and(
          eq(entityComments.tenantId, input.tenantId),
          eq(entityComments.id, input.parentCommentId),
          eq(entityComments.entityType, input.entityType),
          eq(entityComments.entityId, input.entityId),
          isNull(entityComments.deletedAt),
        )).limit(1);
      if (parent.length === 0) throw new Error("PARENT_NOT_FOUND");
    }
    const rows = await tx.insert(entityComments).values({
      id, tenantId: input.tenantId, entityType: input.entityType, entityId: input.entityId,
      parentCommentId: input.parentCommentId ?? null, body: input.body, visibility: input.visibility,
      authorId: input.actorId,
    }).returning();
    return rows[0]!;
  });
}

/** Edit own comment (author-only enforced in the route). */
export async function edit(tenantId: string, id: string, body: string, authorId: string, outer?: Tx): Promise<CommentRow | null> {
  return withTx(outer, async (tx) => {
    const res = await tx.update(entityComments)
      .set({ body, editedAt: new Date() })
      .where(and(eq(entityComments.tenantId, tenantId), eq(entityComments.id, id), eq(entityComments.authorId, authorId), isNull(entityComments.deletedAt)))
      .returning();
    return res[0] ?? null;
  });
}

/** Soft-delete (keeps thread history; hard delete is prohibited by policy). */
export async function softDelete(tenantId: string, id: string, authorId: string, outer?: Tx): Promise<boolean> {
  return withTx(outer, async (tx) => {
    const res = await tx.update(entityComments)
      .set({ deletedAt: new Date() })
      .where(and(eq(entityComments.tenantId, tenantId), eq(entityComments.id, id), eq(entityComments.authorId, authorId), isNull(entityComments.deletedAt)))
      .returning({ id: entityComments.id });
    return res.length > 0;
  });
}
