/**
 * GAP-DESIGNER-HOME-04: read-side queries for the sandbox-test module.
 *
 * Exposed as a domain interface so catalogue (and any future module) can
 * look up latest test outcomes in-process without a cross-module JOIN.
 */
import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { sandboxTestRuns } from "./schema.js";

export type LatestTestStatus = "pass" | "fail" | "pending";

function isStatus(v: string): v is LatestTestStatus {
  return v === "pass" || v === "fail" || v === "pending";
}

/**
 * For a set of service-definition IDs, return the latest sandbox-test status
 * per definition as a Map<definitionId, status>.
 *
 * We fetch the matching runs ordered newest-first and keep the first status we
 * see per definition. This stays inside the sandbox-test module's own schema
 * (packs.sandbox_test_runs) — no cross-module JOIN.
 */
export async function latestTestStatusByDefinitionIds(
  tenantId: string,
  definitionIds: string[],
): Promise<Map<string, LatestTestStatus>> {
  if (definitionIds.length === 0) return new Map();

  const rows = await db.transaction((tx) =>
    tx
      .select({
        serviceDefinitionId: sandboxTestRuns.serviceDefinitionId,
        status: sandboxTestRuns.status,
      })
      .from(sandboxTestRuns)
      .where(
        and(
          eq(sandboxTestRuns.tenantId, tenantId),
          inArray(sandboxTestRuns.serviceDefinitionId, definitionIds),
        ),
      )
      .orderBy(desc(sandboxTestRuns.createdAt)),
  );

  const result = new Map<string, LatestTestStatus>();
  for (const row of rows) {
    if (result.has(row.serviceDefinitionId)) continue; // first = newest
    if (isStatus(row.status)) result.set(row.serviceDefinitionId, row.status);
  }
  return result;
}
