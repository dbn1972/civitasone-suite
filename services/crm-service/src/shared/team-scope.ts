/**
 * Team-based record visibility for crm_user.
 *
 * A crm_user sees records they own PLUS records owned by any member of a team they belong to
 * (crm.team_members). crm_admin / super_admin keep tenant-wide visibility: callers pass no
 * scope for them. The peer set is resolved in SQL (a subquery) so a membership change takes
 * effect on the next read.
 */
import { sql, type SQL, type SQLChunk } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** user ids visible to `actorId`: the actor plus every member of every team the actor is in. */
export function visibleOwnerIdsSql(tenantId: string, actorId: string): SQL {
  return sql`(
    SELECT ${actorId}::uuid
    UNION
    SELECT tm2.user_id
      FROM crm.team_members tm1
      JOIN crm.team_members tm2 ON tm2.team_id = tm1.team_id AND tm2.tenant_id = tm1.tenant_id
     WHERE tm1.tenant_id = ${tenantId} AND tm1.user_id = ${actorId}
  )`;
}

/**
 * Predicate for a record-owner column. `includeUnowned` keeps never-assigned records (the
 * unassigned lead pool a crm_user must see to claim) visible in list views.
 */
export function ownerVisibleSql(col: SQLChunk, tenantId: string, actorId: string, includeUnowned = true): SQL {
  // owner columns are uuid; a non-uuid subject owns nothing (and the ::uuid cast would throw).
  const base = UUID_RE.test(actorId) ? sql`${col} IN ${visibleOwnerIdsSql(tenantId, actorId)}` : sql`false`;
  return includeUnowned ? sql`(${col} IS NULL OR ${base})` : sql`(${base})`;
}
