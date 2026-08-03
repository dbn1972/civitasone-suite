import { randomBytes, createHmac } from "node:crypto";
import { eq, and, gt, asc, desc, or, isNull } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { registeredDevices, mailboxCursors, entityChangelog, processedMutations } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

function trustSecret(): string {
  const secret = process.env.DEVICE_TRUST_SECRET;
  if (!secret) throw new Error("DEVICE_TRUST_SECRET env var is required");
  return secret;
}

export function mintTrustToken(deviceId: string, userId: string): string {
  return createHmac("sha256", trustSecret()).update(`${deviceId}:${userId}`).digest("hex");
}

export async function upsertDevice(
  tx: Writer,
  row: typeof registeredDevices.$inferInsert,
): Promise<void> {
  const existing = await tx.select().from(registeredDevices)
    .where(and(
      eq(registeredDevices.tenantId, row.tenantId),
      eq(registeredDevices.userId, row.userId),
      eq(registeredDevices.fingerprint, row.fingerprint),
    )).limit(1);
  if (existing[0]) {
    await tx.update(registeredDevices).set({
      label: row.label,
      trustToken: row.trustToken,
      trustLevel: row.trustLevel ?? "recognized",
      lastSeenAt: new Date(),
      updatedAt: new Date(),
      updatedBy: row.updatedBy,
    }).where(eq(registeredDevices.id, existing[0].id));
    return;
  }
  await tx.insert(registeredDevices).values(row);
}

export async function findDevice(tenantId: string, deviceId: string, userId: string) {
  const rows = await scopedRead((tx) => tx.select().from(registeredDevices)
    .where(and(eq(registeredDevices.id, deviceId), eq(registeredDevices.tenantId, tenantId), eq(registeredDevices.userId, userId)))
    .limit(1));
  return rows[0] ?? null;
}

export async function getOrCreateCursor(tenantId: string, userId: string, deviceId: string, mailbox: string): Promise<string> {
  const rows = await scopedRead((tx) => tx.select().from(mailboxCursors)
    .where(and(
      eq(mailboxCursors.tenantId, tenantId),
      eq(mailboxCursors.userId, userId),
      eq(mailboxCursors.deviceId, deviceId),
      eq(mailboxCursors.mailbox, mailbox),
    )).limit(1));
  if (rows[0]) return rows[0].cursorValue;
  await db.insert(mailboxCursors).values({ tenantId, userId, deviceId, mailbox, cursorValue: "0" });
  return "0";
}

export async function setCursor(tenantId: string, userId: string, deviceId: string, mailbox: string, cursor: string): Promise<void> {
  await db.update(mailboxCursors).set({ cursorValue: cursor, lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(mailboxCursors.tenantId, tenantId),
      eq(mailboxCursors.userId, userId),
      eq(mailboxCursors.deviceId, deviceId),
      eq(mailboxCursors.mailbox, mailbox),
    ));
}

export async function appendChangelog(entry: {
  tenantId: string; mailbox: string; entityId: string;
  operation: string; payload?: Record<string, unknown>; ownerUserId?: string | null;
}): Promise<{ seq: string; etag: string }> {
  const etag = randomBytes(8).toString("hex");
  const rows = await db.transaction(async (tx) => tx.insert(entityChangelog).values({
    tenantId: entry.tenantId,
    mailbox: entry.mailbox,
    entityId: entry.entityId,
    operation: entry.operation,
    payload: entry.payload ?? null,
    ownerUserId: entry.ownerUserId ?? null,
    etag,
  }).returning({ seq: entityChangelog.seq, etag: entityChangelog.etag }));
  return { seq: String(rows[0]?.seq ?? "0"), etag: rows[0]?.etag ?? etag };
}

export async function appendChangelogBatch(
  tx: Writer,
  entries: Array<{
    tenantId: string; mailbox: string; entityId: string;
    operation: string; payload?: Record<string, unknown>;
  }>,
): Promise<Array<{ seq: string; etag: string }>> {
  if (entries.length === 0) return [];
  const values = entries.map((entry) => ({
    tenantId: entry.tenantId,
    mailbox: entry.mailbox,
    entityId: entry.entityId,
    operation: entry.operation,
    payload: entry.payload ?? null,
    etag: randomBytes(8).toString("hex"),
  }));
  const rows = await tx.insert(entityChangelog).values(values).returning({
    seq: entityChangelog.seq,
    etag: entityChangelog.etag,
  });
  return rows.map((r) => ({ seq: String(r.seq), etag: r.etag }));
}

export async function pullSince(
  tenantId: string,
  mailbox: string,
  sinceSeq: bigint,
  limit: number,
  opts: { userId?: string; userPrivate?: boolean } = {},
) {
  const conditions = [
    eq(entityChangelog.tenantId, tenantId),
    eq(entityChangelog.mailbox, mailbox),
    gt(entityChangelog.seq, sinceSeq),
  ];
  // 03-T7: for a user-private mailbox, only return rows owned by this user (or
  // unowned/shared rows). Rows owned by another user in the tenant are hidden.
  if (opts.userPrivate && opts.userId) {
    conditions.push(
      or(eq(entityChangelog.ownerUserId, opts.userId), isNull(entityChangelog.ownerUserId))!,
    );
  }
  return scopedRead((tx) => tx.select().from(entityChangelog)
    .where(and(...conditions))
    .orderBy(asc(entityChangelog.seq))
    .limit(limit));
}

// ── SYN-1 (03): idempotency, conflict detection, per-mutation apply ──────────

/** Append a single changelog row (used by the per-mutation push path). */
export async function appendChangelogOne(
  tx: Writer,
  entry: { tenantId: string; mailbox: string; entityId: string; operation: string; payload?: Record<string, unknown> },
): Promise<{ seq: string; etag: string }> {
  const etag = randomBytes(8).toString("hex");
  const rows = await tx.insert(entityChangelog).values({
    tenantId: entry.tenantId,
    mailbox: entry.mailbox,
    entityId: entry.entityId,
    operation: entry.operation,
    payload: entry.payload ?? null,
    etag,
  }).returning({ seq: entityChangelog.seq, etag: entityChangelog.etag });
  return { seq: String(rows[0]?.seq ?? "0"), etag: rows[0]?.etag ?? etag };
}

/** SYN-1c: latest committed state for an entity (for conflict detection). */
export async function getLatestEntityState(
  tx: Writer,
  tenantId: string,
  mailbox: string,
  entityId: string,
): Promise<{ etag: string; operation: string; payload: Record<string, unknown> | null } | null> {
  const rows = await tx.select().from(entityChangelog)
    .where(and(
      eq(entityChangelog.tenantId, tenantId),
      eq(entityChangelog.mailbox, mailbox),
      eq(entityChangelog.entityId, entityId),
    ))
    .orderBy(desc(entityChangelog.seq))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { etag: row.etag, operation: row.operation, payload: (row.payload as Record<string, unknown> | null) ?? null };
}

export type ProcessedResult = {
  status: "applied" | "conflict" | "failed";
  resultEtag: string | null;
  resultSeq: string | null;
  reason: string | null;
};

/** SYN-1b: return the stored outcome of a previously-processed mutation. */
export async function findProcessedMutation(
  tx: Writer,
  tenantId: string,
  deviceId: string,
  clientMutationId: string,
): Promise<ProcessedResult | null> {
  const rows = await tx.select().from(processedMutations)
    .where(and(
      eq(processedMutations.tenantId, tenantId),
      eq(processedMutations.deviceId, deviceId),
      eq(processedMutations.clientMutationId, clientMutationId),
    ))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    status: row.status as ProcessedResult["status"],
    resultEtag: row.resultEtag ?? null,
    resultSeq: row.resultSeq != null ? String(row.resultSeq) : null,
    reason: row.reason ?? null,
  };
}

/** SYN-1b: persist a mutation outcome so a replay returns the same result. */
export async function recordProcessedMutation(
  tx: Writer,
  entry: {
    tenantId: string; deviceId: string; clientMutationId: string; mailbox: string;
    entityId: string; status: "applied" | "conflict" | "failed";
    resultEtag?: string | null; resultSeq?: string | null; reason?: string | null;
  },
): Promise<void> {
  await tx.insert(processedMutations).values({
    tenantId: entry.tenantId,
    deviceId: entry.deviceId,
    clientMutationId: entry.clientMutationId,
    mailbox: entry.mailbox,
    entityId: entry.entityId,
    status: entry.status,
    resultEtag: entry.resultEtag ?? null,
    resultSeq: entry.resultSeq != null ? BigInt(entry.resultSeq) : null,
    reason: entry.reason ?? null,
  });
}
