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
 */
export async function reassignProfile(
  tx: ScopedTx,
  fromProfileId: string,
  toProfileId: string,
  tenantId: string,
): Promise<void> {
  await tx
    .update(identityGraph)
    .set({ profileId: toProfileId })
    .where(and(eq(identityGraph.profileId, fromProfileId), eq(identityGraph.tenantId, tenantId)));
}
