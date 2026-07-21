import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { projectGeoTags, projectSitePhotos, type GeoTagInsert, type SitePhotoInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertGeoTag(tx: Writer, row: GeoTagInsert): Promise<void> {
  await tx.insert(projectGeoTags).values(row);
}

export async function listGeoTagsByProject(projectId: string, tenantId: string, limit = 500): Promise<(typeof projectGeoTags.$inferSelect)[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(projectGeoTags)
    .where(and(eq(projectGeoTags.projectId, projectId), eq(projectGeoTags.tenantId, tenantId)))
    .limit(limit));
}

export async function insertSitePhoto(tx: Writer, row: SitePhotoInsert): Promise<void> {
  await tx.insert(projectSitePhotos).values(row);
}
