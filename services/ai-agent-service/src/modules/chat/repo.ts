/**
 * chat/repo.ts — Database operations for conversations and transcript messages.
 * Every query is tenant-filtered; writes take a ScopedTx, reads go via scopedRead.
 */
import { eq, and, sql, desc, asc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import {
  conversations,
  messages,
  type ConversationRow,
  type ConversationInsert,
  type MessageRow,
  type MessageInsert,
} from "./schema.js";

export function toView(r: ConversationRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    channelId: r.channelId,
    profileId: r.profileId,
    status: r.status,
    language: r.language,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    handedOffAt: r.handedOffAt ? r.handedOffAt.toISOString() : null,
    handoffReason: r.handoffReason,
    handoffNote: r.handoffNote,
    handoffQueue: r.handoffQueue,
    handoffContext: r.handoffContext ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type ConversationView = ReturnType<typeof toView>;

export function toMessageView(r: MessageRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    conversationId: r.conversationId,
    role: r.role,
    content: r.content,
    tokens: r.tokens,
    createdAt: r.createdAt.toISOString(),
    version: r.version,
  };
}

export type MessageView = ReturnType<typeof toMessageView>;

export async function findById(id: string, tenantId: string): Promise<ConversationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  status?: string;
  profileId?: string;
  channelId?: string;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: ConversationRow[]; total: number }> {
  const conditions: SQL[] = [eq(conversations.tenantId, tenantId)];
  if (filters.status) conditions.push(eq(conversations.status, filters.status));
  if (filters.profileId) conditions.push(eq(conversations.profileId, filters.profileId));
  if (filters.channelId) conditions.push(eq(conversations.channelId, filters.channelId));
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(conversations)
      .where(where)
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(conversations).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: ConversationInsert): Promise<void> {
  await tx.insert(conversations).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<ConversationInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(conversations)
    .set({ ...patch, updatedAt: new Date(), version: sql`${conversations.version} + 1` })
    .where(and(
      eq(conversations.id, id),
      eq(conversations.tenantId, tenantId),
      eq(conversations.version, currentVersion),
    ))
    .returning({ id: conversations.id });
  return result.length > 0;
}

/**
 * Move a conversation to `handed_off`, guarded on it still being `active`
 * rather than on a version. The auto-handoff path runs inside the same
 * transaction as the turn that triggered it, where the caller has no fresh
 * version to compare; guarding on the source state keeps the write idempotent
 * and stops a late escalation from re-opening an already-ended conversation.
 * Returns false when the conversation had already moved on.
 */
export async function markHandedOff(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: {
    handoffReason: string;
    handoffNote: string | null;
    handoffQueue: string | null;
    handoffContext: unknown;
    updatedBy: string;
  },
): Promise<boolean> {
  const result = await tx
    .update(conversations)
    .set({
      status: "handed_off",
      handedOffAt: new Date(),
      ...patch,
      updatedAt: new Date(),
      version: sql`${conversations.version} + 1`,
    })
    .where(and(
      eq(conversations.id, id),
      eq(conversations.tenantId, tenantId),
      eq(conversations.status, "active"),
    ))
    .returning({ id: conversations.id });
  return result.length > 0;
}

export async function insertMessage(tx: ScopedTx, row: MessageInsert): Promise<void> {
  await tx.insert(messages).values(row);
}

export async function listMessages(
  conversationId: string,
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: MessageRow[]; total: number }> {
  const where = and(eq(messages.tenantId, tenantId), eq(messages.conversationId, conversationId));

  const rows = await scopedRead((tx) =>
    tx.select().from(messages)
      .where(where)
      .orderBy(asc(messages.createdAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(messages).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}
