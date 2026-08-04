import { cache } from "../../shared/infra.js";
const RESOURCE = "activity";
import * as repo from "./repo.js";
import type { ActivitySubjectType } from "./repo.js";
import type { ActivityView } from "./schema.js";

/**
 * The per-record activity timeline, scoped to one subject (contact/deal/account).
 * The cache key carries the subject so one subject's page never serves another's.
 */
export async function listActivities(
  tenantId: string,
  subjectType: ActivitySubjectType,
  subjectId: string,
  limit: number,
  offset: number,
): Promise<{ data: ActivityView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, RESOURCE, `list:${subjectType}:${subjectId}:${limit}:${offset}`, async () => {
    const rows = await repo.listBySubject(tenantId, subjectType, subjectId, limit, offset);
    return {
      data: rows,
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}
