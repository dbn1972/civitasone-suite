/**
 * identity/repo.ts — Database operations for identity graph.
 */
import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { identityGraph, type IdentityGraphRow, type IdentityGraphInsert } from "./schema.js";

export function toView(r: IdentityGraphRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    profileId: r.profileId,
    identifierType: r.identifierType,
    identifierHash: r.identifierHash,
    confidence: r.confidence,
    createdAt: r.createdAt.toISOString(),
  };
}

export type IdentityView = ReturnType<typeof toView>;

/**
 * Find all identity graph entries matching a specific hash (for resolution).
 */
export async function findByHash(hash: string, tenantId: string): Promise<IdentityGraphRow[]> {
  return scopedRead((tx) =>
    tx.select().from(identityGraph)
      .where(and(eq(identityGraph.identifierHash, hash), eq(identityGraph.tenantId, tenantId))),
  );
}

/**
 * Find all identifiers linked to a profile.
 */
export async function findByProfileId(profileId: string, tenantId: string): Promise<IdentityGraphRow[]> {
  return scopedRead((tx) =>
    tx.select().from(identityGraph)
      .where(and(eq(identityGraph.profileId, profileId), eq(identityGraph.tenantId, tenantId))),
  );
}

/**
 * Find a single identity graph entry by ID.
 */
export async function findById(id: string, tenantId: string): Promise<IdentityGraphRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(identityGraph)
      .where(and(eq(identityGraph.id, id), eq(identityGraph.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Insert a new identity graph link.
 */
export async function insert(tx: ScopedTx, row: IdentityGraphInsert): Promise<void> {
  await tx.insert(identityGraph).values(row);
}

/**
 * Delete an identity link (unlink identifier from profile).
 */
export async function deleteById(tx: ScopedTx, id: string, tenantId: string): Promise<boolean> {
  const result = await tx
    .delete(identityGraph)
    .where(and(eq(identityGraph.id, id), eq(identityGraph.tenantId, tenantId)))
    .returning({ id: identityGraph.id });
  return result.length > 0;
}

/**
 * Reassign all identity links from one profile to another (used during merge).
 *
 * Returns the number of edges moved. CR-CDP-04 records that count on the visitor register
 * so a stitch can be shown to have actually moved the identifiers it claims; existing
 * callers (steward merge) may ignore it.
 */
export async function reassignProfile(
  tx: ScopedTx,
  fromProfileId: string,
  toProfileId: string,
  tenantId: string,
): Promise<number> {
  const result = await tx
    .update(identityGraph)
    .set({ profileId: toProfileId })
    .where(and(eq(identityGraph.profileId, fromProfileId), eq(identityGraph.tenantId, tenantId)))
    .returning({ id: identityGraph.id });
  return result.length;
}

/**
 * Remove every identifier edge pointing at a profile.
 *
 * DSAR erasure (CDP-011): `identifierHash` is a hash of an email/phone, which is still
 * personal data under DPDP Act 2023 — an erasure that left the edges in place would let
 * the same subject be re-resolved onto the profile by the next ingest. The DSAR register
 * row keeps the audit linkage, so removing the edges loses no evidence.
 *
 * Returns the number of edges removed.
 */
export async function deleteByProfile(tx: ScopedTx, profileId: string, tenantId: string): Promise<number> {
  const result = await tx
    .delete(identityGraph)
    .where(and(eq(identityGraph.profileId, profileId), eq(identityGraph.tenantId, tenantId)))
    .returning({ id: identityGraph.id });
  return result.length;
}

/**
 * Read the edges for one identifier hash inside the caller's transaction.
 *
 * `findByHash` opens its own transaction (scopedRead), which a consumer cannot reuse once
 * it has claimed the message: the read, the idempotency claim and the write have to share
 * one transaction or a crash between them leaves the message marked processed with no write.
 */
export async function findByHashTx(tx: ScopedTx, hash: string, tenantId: string): Promise<IdentityGraphRow[]> {
  return tx.select().from(identityGraph)
    .where(and(eq(identityGraph.identifierHash, hash), eq(identityGraph.tenantId, tenantId)));
}
