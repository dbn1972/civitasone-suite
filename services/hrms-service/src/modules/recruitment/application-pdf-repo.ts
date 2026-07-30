import { eq, and } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { hrmsJobOpenings } from "./schema.js";

/** Vacancy title + ref for the application-copy header (tenant-scoped). */
export async function getVacancyHeader(tenantId: string, jobOpeningId: string): Promise<{ title: string; refNo: string } | null> {
  const rows = await scopedRead((tx) => tx.select({ title: hrmsJobOpenings.title, refNo: hrmsJobOpenings.refNo }).from(hrmsJobOpenings)
    .where(and(eq(hrmsJobOpenings.tenantId, tenantId), eq(hrmsJobOpenings.id, jobOpeningId))).limit(1));
  return rows[0] ?? null;
}
