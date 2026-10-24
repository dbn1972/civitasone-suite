import { cache } from "../../shared/infra.js";
const RESOURCE = "activity";
import * as repo from "./repo.js";
import type { ActivitySubjectType } from "./repo.js";
import type { ActivityView } from "./schema.js";
import type { ActivityFeedQuery, ActivityFeedItem } from "./validators.js";
import { resolveUserNames } from "../../shared/user-directory.js";

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

/**
 * Scoped feed (no subject). NOT cached: the result depends on the caller (crm_user scope), so a
 * tenant-keyed cache entry would leak one user's feed to another.
 */
export async function listFeed(
  tenantId: string,
  actorId: string,
  isAdmin: boolean,
  q: ActivityFeedQuery,
): Promise<{ data: ActivityFeedItem[]; pagination: { hasMore: boolean; pageSize: number; total: number; cursor?: string } }> {
  const { rows, total } = await repo.listFeed(tenantId, isAdmin ? null : actorId, q, actorId);
  const names = await resolveUserNames(tenantId, rows.map((r) => r.ownerId));
  const data: ActivityFeedItem[] = rows.map((r) => ({
    id: r.id, tenantId: r.tenantId, actorName: r.actorName, text: r.text,
    contactId: r.contactId, dealId: r.dealId, accountId: r.accountId,
    type: r.type, subject: r.subject, status: r.status as ActivityFeedItem["status"],
    dueDate: r.dueDate, remindAt: r.remindAt, location: r.location,
    completedAt: r.completedAt, createdAt: r.createdAt,
    ownerId: r.ownerId,
    owner: (r.ownerId ? names.get(r.ownerId) : undefined) ?? "—",
    relatedType: r.contactId ? "contact" : r.dealId ? "deal" : r.accountId ? "other" : null,
    relatedTo: r.relatedName,
  }));
  return {
    data,
    pagination: {
      hasMore: q.offset + rows.length < total,
      pageSize: q.limit,
      total,
      ...(rows.length ? { cursor: String(q.offset + rows.length) } : {}),
    },
  };
}
