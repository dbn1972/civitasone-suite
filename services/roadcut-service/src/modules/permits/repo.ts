import { eq, and, ne, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { roadcutPermits, type RoadcutPermitRow, type RoadcutPermitInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<RoadcutPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(roadcutPermits)
      .where(and(eq(roadcutPermits.id, id), eq(roadcutPermits.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

// BUG FIX: this used to match ANY permit for the application regardless of
// status, so permits/routes.ts's PERMIT_ALREADY_EXISTS pre-accept check
// (this function's only caller) permanently blocked re-issuance after a
// permit was cancelled -- contradicting both the migration comment on
// this table (schema.ts: "a cancelled permit must not block a legitimate
// re-issuance for the same application") and the actual DB-level
// constraint enforcing it (migrations/0002_permit_restoration_unique_
// constraints.sql's partial unique index, `WHERE status != 'cancelled'`).
// Confirmed live via the test suite: issuing, cancelling, then re-issuing
// a permit for the same application returned 409 PERMIT_ALREADY_EXISTS
// even though the DB itself would have allowed the insert. Excluding
// 'cancelled' here makes the application-level pre-check agree with the
// constraint it exists to pre-empt.
export async function findByApplication(applicationId: string, tenantId: string): Promise<RoadcutPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(roadcutPermits)
      .where(and(
        eq(roadcutPermits.applicationId, applicationId),
        eq(roadcutPermits.tenantId, tenantId),
        ne(roadcutPermits.status, "cancelled"),
      ))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: RoadcutPermitRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(roadcutPermits.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(roadcutPermits.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(roadcutPermits)
      .where(and(...conditions))
      .orderBy(desc(roadcutPermits.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(roadcutPermits)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertPermit(tx: ScopedTx, row: RoadcutPermitInsert): Promise<void> {
  await tx.insert(roadcutPermits).values(row);
}

// BUG FIX: the consumer previously derived the permit_number's trailing
// digits from `Date.now() % 999999` -- periodic, not random, so two commands
// processed in the same millisecond collide deterministically against
// permit_number's UNIQUE constraint, poison-pilling the consumer transaction
// (it never commits, so the outbox message is stuck). A real Postgres
// SEQUENCE (migrations/0003_number_sequences.sql) makes every value
// distinct by construction. Mirrors fire-service's identical fix
// (nextApplicationNumber, PR #1011) and animal-service's (PR #1007).
export async function nextPermitNumber(tx: ScopedTx): Promise<number> {
  const [row] = (await tx.execute(
    sql`SELECT nextval('"roadcut"."permit_number_seq"')::bigint AS seq`,
  )) as Array<{ seq: number }>;
  return Number(row!.seq);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(roadcutPermits)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${roadcutPermits.version} + 1`,
    })
    .where(and(eq(roadcutPermits.id, id), eq(roadcutPermits.tenantId, tenantId)))
    .returning({ id: roadcutPermits.id });
  return result.length > 0;
}

export async function extendPermit(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  extendedUntil: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(roadcutPermits)
    .set({
      status: "extended",
      extendedUntil,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${roadcutPermits.version} + 1`,
    })
    .where(and(eq(roadcutPermits.id, id), eq(roadcutPermits.tenantId, tenantId)))
    .returning({ id: roadcutPermits.id });
  return result.length > 0;
}
