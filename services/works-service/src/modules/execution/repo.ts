import { eq, and } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { workScopes, scopeProgress, workIssues, workClosures, physicalCompletions } from "./schema.js";

export async function listScopes(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(workScopes)
      .where(and(eq(workScopes.tenantId, tenantId), eq(workScopes.workId, workId)));
  });
}

export async function listIssues(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(workIssues)
      .where(and(eq(workIssues.tenantId, tenantId), eq(workIssues.workId, workId)));
  });
}

export async function hasPhysicalCompletion(tenantId: string, workId: string): Promise<boolean> {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(physicalCompletions)
      .where(and(eq(physicalCompletions.tenantId, tenantId), eq(physicalCompletions.workId, workId)))
      .limit(1);
    return rows.length > 0;
  });
}
