import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { projectGeoTags, projectSitePhotos, type GeoTagInsert, type SitePhotoInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertGeoTag(tx: Writer, row: GeoTagInsert): Promise<void> {
  await tx.insert(projectGeoTags).values(row);
}

export async function listGeoTagsByProject(projectId: string): Promise<(typeof projectGeoTags.$inferSelect)[]> {
  return db.select().from(projectGeoTags).where(eq(projectGeoTags.projectId, projectId));
}

export async function insertSitePhoto(tx: Writer, row: SitePhotoInsert): Promise<void> {
  await tx.insert(projectSitePhotos).values(row);
}
