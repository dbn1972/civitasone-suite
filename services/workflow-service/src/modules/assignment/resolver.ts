import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { pgSchema, uuid, varchar, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { tasks } from "../tasks/schema.js";

const domainSchema = pgSchema("workflow");

/**
 * Gap 4 — candidate role-holders for auto-assignment. workflow-service has no
 * user directory; a tenant registers role memberships (+ optional reporting
 * line) here, synced from identity or set by admin.
 */
export const roleMembers = domainSchema.table("role_members", {
  tenantId: uuid("tenant_id").notNull(),
  roleRef: varchar("role_ref", { length: 128 }).notNull(),
  userId: uuid("user_id").notNull(),
  reportsTo: uuid("reports_to"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Round-robin cursor per (tenant, role): last index handed out. */
export const assignmentCursors = domainSchema.table("assignment_cursors", {
  tenantId: uuid("tenant_id").notNull(),
  roleRef: varchar("role_ref", { length: 128 }).notNull(),
  lastIndex: integer("last_index").notNull().default(-1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Writer = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export type MemberRow = { userId: string; reportsTo: string | null };

/** Active role-holders for a role in a tenant, ordered stably by user_id. */
export async function activeMembersTx(tx: Writer, tenantId: string, roleRef: string): Promise<MemberRow[]> {
  const rows = await (tx as typeof db).select({ userId: roleMembers.userId, reportsTo: roleMembers.reportsTo })
    .from(roleMembers)
    .where(and(eq(roleMembers.tenantId, tenantId), eq(roleMembers.roleRef, roleRef), eq(roleMembers.active, true)))
    .orderBy(roleMembers.userId);
  return rows;
}

/**
 * Resolve an auto-assignee for a task node according to its strategy. Returns a
 * user id, or null when no strategy / no candidates (the task stays in the
 * legacy role pool, claimable by any role-holder).
 *
 *  - round_robin: next candidate after the stored cursor (advances the cursor).
 *  - least_loaded: the role-holder with the fewest open (pending) tasks.
 *  - hierarchy: the role-holder whose reports_to == assignRef (the role-holder
 *    reporting to a given manager); falls back to round-robin among the
 *    matching set if several report to the same manager.
 *
 * Runs inside the spawning transaction so the cursor advance commits atomically
 * with the task insert.
 */
export async function resolveAssignee(
  tx: Writer,
  tenantId: string,
  roleRef: string | null,
  strategy: string | null | undefined,
  assignRef: string | null | undefined,
): Promise<string | null> {
  if (!roleRef || !strategy || strategy === "none") return null;
  const members = await activeMembersTx(tx, tenantId, roleRef);
  if (members.length === 0) return null;

  if (strategy === "hierarchy") {
    const reporting = assignRef ? members.filter((m) => m.reportsTo === assignRef) : members;
    const pool = reporting.length > 0 ? reporting : members;
    // deterministic pick within the matching set via the round-robin cursor.
    return nextRoundRobin(tx, tenantId, roleRef, pool);
  }

  if (strategy === "least_loaded") {
    return leastLoaded(tx, tenantId, roleRef, members);
  }

  // default: round_robin
  return nextRoundRobin(tx, tenantId, roleRef, members);
}

async function nextRoundRobin(tx: Writer, tenantId: string, roleRef: string, pool: MemberRow[]): Promise<string | null> {
  if (pool.length === 0) return null;
  // upsert + advance the cursor atomically, returning the new index.
  const res = await (tx as typeof db).execute(sql`
    INSERT INTO workflow.assignment_cursors (tenant_id, role_ref, last_index, updated_at)
    VALUES (${tenantId}, ${roleRef}, 0, now())
    ON CONFLICT (tenant_id, role_ref)
    DO UPDATE SET last_index = workflow.assignment_cursors.last_index + 1, updated_at = now()
    RETURNING last_index
  `);
  const rows = res as unknown as Array<{ last_index: number }>;
  const idx = rows[0]?.last_index ?? 0;
  return pool[idx % pool.length]?.userId ?? null;
}

async function leastLoaded(tx: Writer, tenantId: string, roleRef: string, members: MemberRow[]): Promise<string | null> {
  // count open (pending) tasks per candidate within the tenant.
  let best: string | null = null;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const m of members) {
    const rows = await (tx as typeof db).select({ n: sql<number>`count(*)::int` }).from(tasks)
      .where(and(eq(tasks.tenantId, tenantId), eq(tasks.status, "pending"), eq(tasks.assigneeId, m.userId)));
    const count = rows[0]?.n ?? 0;
    if (count < bestCount) { bestCount = count; best = m.userId; }
  }
  return best;
}
