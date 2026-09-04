import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { roadcutApplications, type RoadcutApplicationRow, type RoadcutApplicationInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<RoadcutApplicationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(roadcutApplications)
      .where(and(eq(roadcutApplications.id, id), eq(roadcutApplications.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByNumber(applicationNumber: string, tenantId: string): Promise<RoadcutApplicationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(roadcutApplications)
      .where(and(eq(roadcutApplications.applicationNumber, applicationNumber), eq(roadcutApplications.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: RoadcutApplicationRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(roadcutApplications.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(roadcutApplications.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(roadcutApplications)
      .where(and(...conditions))
      .orderBy(desc(roadcutApplications.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(roadcutApplications)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertApplication(tx: ScopedTx, row: RoadcutApplicationInsert): Promise<void> {
  await tx.insert(roadcutApplications).values(row);
}

// BUG FIX: the consumer previously derived the application_number's trailing
// digits from `Date.now() % 999999` -- periodic, not random, so two commands
// processed in the same millisecond collide deterministically against
// application_number's UNIQUE constraint, poison-pilling the consumer
// transaction (it never commits, so the outbox message is stuck). A real
// Postgres SEQUENCE (migrations/0003_number_sequences.sql) makes every
// value distinct by construction. Mirrors fire-service's identical fix
// (nextApplicationNumber, PR #1011) and animal-service's (PR #1007).
export async function nextApplicationNumber(tx: ScopedTx): Promise<number> {
  const [row] = (await tx.execute(
    sql`SELECT nextval('"roadcut"."application_number_seq"')::bigint AS seq`,
  )) as Array<{ seq: number }>;
  return Number(row!.seq);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
  fromStatus: string,
): Promise<boolean> {
  // The route's canTransition() pre-check and this write happen in two
  // separate steps (route -> queue -> consumer) with nothing holding the row
  // in between — two concurrent transitions off the same starting status
  // (e.g. one admin approving while another rejects the same under_review
  // application) can each independently pass the route's check. Re-asserting
  // the expected prior status in the WHERE clause (not just id+tenantId)
  // makes the second of two racing commands a genuine no-op instead of
  // silently overwriting the first decision — the same pattern used for
  // restoration's completeRestoration/updateDepositRefund.
  const result = await tx.update(roadcutApplications)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      ...(status === "submitted" ? { submittedAt: new Date() } : {}),
      version: sql`${roadcutApplications.version} + 1`,
    })
    .where(and(
      eq(roadcutApplications.id, id),
      eq(roadcutApplications.tenantId, tenantId),
      eq(roadcutApplications.status, fromStatus),
    ))
    .returning({ id: roadcutApplications.id });
  return result.length > 0;
}
