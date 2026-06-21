import { randomBytes, createHmac } from "node:crypto";
import { eq, and, gt, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { registeredDevices, mailboxCursors, entityChangelog } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

function trustSecret(): string {
  const secret = process.env.DEVICE_TRUST_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DEVICE_TRUST_SECRET is required in production");
    }
    return "dev_device_trust_secret_change_in_prod";
  }
  return secret;
}

export function mintTrustToken(deviceId: string, userId: string): string {
  return createHmac("sha256", trustSecret()).update(`${deviceId}:${userId}`).digest("hex");
}

export async function upsertDevice(row: typeof registeredDevices.$inferInsert): Promise<void> {
  const existing = await db.select().from(registeredDevices)
    .where(and(
      eq(registeredDevices.tenantId, row.tenantId),
      eq(registeredDevices.userId, row.userId),
      eq(registeredDevices.fingerprint, row.fingerprint),
    )).limit(1);
  if (existing[0]) {
    await db.update(registeredDevices).set({
      label: row.label,
      trustToken: row.trustToken,
      trustLevel: row.trustLevel ?? "recognized",
      lastSeenAt: new Date(),
      updatedAt: new Date(),
      updatedBy: row.updatedBy,
    }).where(eq(registeredDevices.id, existing[0].id));
    return;
  }
  await db.insert(registeredDevices).values(row);
}

export async function findDevice(tenantId: string, deviceId: string, userId: string) {
  const rows = await db.select().from(registeredDevices)
    .where(and(eq(registeredDevices.id, deviceId), eq(registeredDevices.tenantId, tenantId), eq(registeredDevices.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getOrCreateCursor(tenantId: string, userId: string, deviceId: string, mailbox: string): Promise<string> {
  const rows = await db.select().from(mailboxCursors)
    .where(and(
      eq(mailboxCursors.tenantId, tenantId),
      eq(mailboxCursors.userId, userId),
      eq(mailboxCursors.deviceId, deviceId),
      eq(mailboxCursors.mailbox, mailbox),
    )).limit(1);
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
  operation: string; payload?: Record<string, unknown>;
}): Promise<{ seq: string; etag: string }> {
  const etag = randomBytes(8).toString("hex");
  const rows = await db.insert(entityChangelog).values({
    tenantId: entry.tenantId,
    mailbox: entry.mailbox,
    entityId: entry.entityId,
    operation: entry.operation,
    payload: entry.payload ?? null,
    etag,
  }).returning({ seq: entityChangelog.seq, etag: entityChangelog.etag });
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

export async function pullSince(tenantId: string, mailbox: string, sinceSeq: bigint, limit: number) {
  return db.select().from(entityChangelog)
    .where(and(
      eq(entityChangelog.tenantId, tenantId),
      eq(entityChangelog.mailbox, mailbox),
      gt(entityChangelog.seq, sinceSeq),
    ))
    .orderBy(asc(entityChangelog.seq))
    .limit(limit);
}
