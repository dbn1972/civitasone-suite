import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { fireNocsTable } from "./schema.js";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import type { FireNocInsert } from "./schema.js";

export async function findById(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(fireNocsTable)
      .where(and(eq(fireNocsTable.tenantId, tenantId), eq(fireNocsTable.id, id)))
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * Pre-fix, this selected straight from fireNocsTable (FORCE ROW LEVEL
 * SECURITY, tenant_id-equality policy) with no tenant predicate of its own,
 * relying entirely on the RLS GUC. GET /v1/fire/nocs/verify is a
 * deliberately public, unauthenticated route (a citizen/other department
 * checking a NOC by its verification code, no login, no tenant known), so
 * no GUC is ever set for it -- the policy's `tenant_id = NULL` predicate
 * matches nothing, and this returned 0 rows for every code, forever (see
 * migrations/0003_noc_public_directory.sql for the full mechanism, and the
 * matching fix already shipped for trade-service in
 * services/trade-service/migrations/0002_licence_public_directory.sql).
 * Now reads the non-RLS public directory table instead, which carries only
 * already-public NOC facts (no applicant/building PII).
 */
export async function findPublicByVerificationCode(verificationCode: string) {
  return scopedRead(async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT verification_code AS "verificationCode", noc_number AS "nocNumber", status,
                 issued_at AS "issuedAt", valid_from AS "validFrom", valid_until AS "validUntil"
          FROM fire_nocs.fire_noc_directory
          WHERE verification_code = ${verificationCode}
          LIMIT 1`,
    )) as Array<{
      verificationCode: string;
      nocNumber: string;
      status: string;
      issuedAt: Date | null;
      validFrom: string | null;
      validUntil: string | null;
    }>;
    return rows[0] ?? null;
  });
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; limit?: number | undefined; offset?: number | undefined } = {},
) {
  return scopedRead(async (tx) => {
    const conditions = [eq(fireNocsTable.tenantId, tenantId)];
    if (opts.status) conditions.push(eq(fireNocsTable.status, opts.status));

    const where = and(...conditions);
    const rows = await tx
      .select()
      .from(fireNocsTable)
      .where(where)
      .orderBy(desc(fireNocsTable.createdAt))
      .limit(opts.limit ?? 25)
      .offset(opts.offset ?? 0);

    const countResult = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(fireNocsTable)
      .where(where);

    return { rows, total: countResult[0]?.total ?? 0 };
  });
}

export async function insert(tx: ScopedTx, data: FireNocInsert) {
  const rows = await tx.insert(fireNocsTable).values(data).returning();
  return rows[0]!;
}

/**
 * Fleet-wide fix (see migrations/0002_number_sequences.sql): replaces
 * consumer.ts's previous randomInt(1, 999999) draw, which was a real
 * collision risk against noc_number's UNIQUE constraint at moderate volume.
 * Called from inside the same transaction that inserts the row, mirroring
 * animal-service's repo.nextComplaintNumber (PR #1007).
 */
export async function nextNocNumber(tx: ScopedTx): Promise<number> {
  const [row] = (await tx.execute(
    sql`SELECT nextval('"fire_nocs"."noc_number_seq"')::bigint AS seq`,
  )) as Array<{ seq: number }>;
  return Number(row!.seq);
}

/**
 * Keeps fire_noc_directory (the non-RLS public verification table) in sync
 * at the same point a NOC is first issued. Must run inside the same
 * transaction as repo.insert() so the two can never drift -- see
 * migrations/0003_noc_public_directory.sql.
 */
export async function insertPublicDirectory(
  tx: ScopedTx,
  row: {
    verificationCode: string;
    tenantId: string;
    nocId: string;
    nocNumber: string;
    status: string;
    issuedAt: Date;
    validFrom: string;
    validUntil: string;
  },
): Promise<void> {
  // BUG FIX (found via a direct debug repro, since MemoryQueue.deliver()
  // swallows handler errors into queue.dlq rather than throwing/logging):
  // a raw JS Date interpolated directly into this tagged sql template
  // crashed postgres-js with "The 'string' argument must be of type string
  // or an instance of Buffer or ArrayBuffer. Received an instance of Date"
  // -- unlike the typed drizzle .insert(fireNocsTable).values({issuedAt:
  // Date}) call above, which serializes Date columns itself, tx.execute()
  // on a raw sql template does not coerce parameters, so it must be given
  // an explicit ISO string. This silently rolled back the ENTIRE issueNoc
  // transaction (the NOC row itself was never persisted either), which is
  // why this bug was only found once NOC issuance was actually tested.
  await tx.execute(
    sql`INSERT INTO fire_nocs.fire_noc_directory
          (verification_code, tenant_id, noc_id, noc_number, status, issued_at, valid_from, valid_until)
        VALUES (${row.verificationCode}, ${row.tenantId}, ${row.nocId}, ${row.nocNumber}, ${row.status},
                ${row.issuedAt.toISOString()}, ${row.validFrom}, ${row.validUntil})`,
  );
}

/**
 * Keeps fire_noc_directory's status in sync on suspend/revoke. Must run
 * inside the same transaction as the corresponding repo.updateStatus() call
 * -- see migrations/0003_noc_public_directory.sql.
 */
export async function updatePublicDirectoryStatus(tx: ScopedTx, nocId: string, status: string): Promise<void> {
  await tx.execute(
    sql`UPDATE fire_nocs.fire_noc_directory SET status = ${status}, updated_at = now() WHERE noc_id = ${nocId}`,
  );
}

/** Used to prevent issuing a second active NOC for an application that already has one. */
export async function findActiveByApplicationId(tenantId: string, applicationId: string) {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(fireNocsTable)
      .where(and(
        eq(fireNocsTable.tenantId, tenantId),
        eq(fireNocsTable.applicationId, applicationId),
        inArray(fireNocsTable.status, ["issued", "active"]),
      ))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function updateStatus(
  tx: ScopedTx,
  tenantId: string,
  id: string,
  status: string,
  fromStatuses: readonly string[],
  actorId: string,
) {
  // BUG FIX: drizzle's inArray() throws on an empty array instead of
  // compiling to an always-false predicate. Same guard as applications/
  // repo.ts and animal-service's repo.ts (PR #1007).
  if (fromStatuses.length === 0) return null;

  const rows = await tx
    .update(fireNocsTable)
    .set({
      status,
      version: sql`${fireNocsTable.version} + 1`,
      updatedAt: new Date(),
      updatedBy: actorId,
    })
    .where(and(
      eq(fireNocsTable.tenantId, tenantId),
      eq(fireNocsTable.id, id),
      inArray(fireNocsTable.status, fromStatuses as string[]),
    ))
    .returning();
  return rows[0] ?? null;
}
