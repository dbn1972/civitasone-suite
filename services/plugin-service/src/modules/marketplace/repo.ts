import { eq, and, ne, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { marketplaceListings, marketplaceReviews } from "./schema.js";
import { plugins } from "../registry/schema.js";
export async function listListings() { return db.select().from(marketplaceListings).where(eq(marketplaceListings.isActive, true)).orderBy(marketplaceListings.name); }
export async function findListing(id: string) { const rows = await db.select().from(marketplaceListings).where(eq(marketplaceListings.id, id)).limit(1); return rows[0]; }

type Reader = Pick<typeof db, "select">;
type Writer = Pick<typeof db, "select" | "update">;

/** Listing lookup on a transaction handle (the consumer reads inside its own tx). */
export async function findListingTx(tx: Reader, id: string) {
  const rows = await tx.select().from(marketplaceListings).where(eq(marketplaceListings.id, id)).limit(1);
  return rows[0];
}

/**
 * Registry plugin this tenant already holds for a marketplace listing (any state
 * but uninstalled). registry.plugins is FORCE RLS, so this MUST run on a
 * GUC-scoped transaction handle (the consumer tx, or a route's db.transaction()).
 */
export async function findInstalledByListingTx(tx: Reader, tenantId: string, listingId: string) {
  const rows = await tx
    .select({ id: plugins.id, state: plugins.state })
    .from(plugins)
    .where(and(eq(plugins.tenantId, tenantId), ne(plugins.state, "uninstalled"), sql`${plugins.manifestJson} ->> 'marketplaceListingId' = ${listingId}`))
    .limit(1);
  return rows[0];
}

export async function bumpInstallCountTx(tx: Writer, listingId: string): Promise<void> {
  await tx.update(marketplaceListings).set({ installs: sql`${marketplaceListings.installs} + 1` }).where(eq(marketplaceListings.id, listingId));
}

export async function findReviewTx(tx: Reader, tenantId: string, listingId: string, reviewerId: string) {
  const rows = await tx
    .select()
    .from(marketplaceReviews)
    .where(and(eq(marketplaceReviews.tenantId, tenantId), eq(marketplaceReviews.listingId, listingId), eq(marketplaceReviews.reviewerId, reviewerId)))
    .limit(1);
  return rows[0];
}

/**
 * Applies a rating change to the global listing atomically in SQL (no read-modify-write),
 * so concurrent tenants cannot lose an update. `countDelta` is 1 for a first review, 0 for an edit.
 */
export async function applyRatingTx(tx: Writer, listingId: string, sumDelta: number, countDelta: number): Promise<void> {
  await tx
    .update(marketplaceListings)
    .set({
      ratingSum: sql`${marketplaceListings.ratingSum} + ${sumDelta}`,
      ratingCount: sql`${marketplaceListings.ratingCount} + ${countDelta}`,
      rating: sql`ROUND((${marketplaceListings.ratingSum} + ${sumDelta})::numeric / NULLIF(${marketplaceListings.ratingCount} + ${countDelta}, 0), 1)`,
    })
    .where(eq(marketplaceListings.id, listingId));
}
