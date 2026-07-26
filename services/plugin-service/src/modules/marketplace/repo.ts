import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { marketplaceListings } from "./schema.js";
export async function listListings() { return db.select().from(marketplaceListings).where(eq(marketplaceListings.isActive, true)).orderBy(marketplaceListings.name); }
export async function findListing(id: string) { const rows = await db.select().from(marketplaceListings).where(eq(marketplaceListings.id, id)).limit(1); return rows[0]; }
