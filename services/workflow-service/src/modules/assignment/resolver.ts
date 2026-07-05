import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { pgSchema, uuid, varchar, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { tasks } from "../tasks/schema.js";
import { resolveFromMatrix, findActiveSubstitute } from "./matrix-repo.js";

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
 *  - matrix: evaluate responsibility_matrix condition rules against context,
 *    return first matching user by priority.
 *  - authority_chain: walk up reports_to N levels (assignRef = number of levels).
 *    Start from context.creatorId or first role member.
 *
 * After resolving, checks substitution_rules: if the resolved user has an active
 * substitution for today, returns the substitute instead.
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
  context?: Record<string, unknown>,
): Promise<string | null> {
  if (!roleRef || !strategy || strategy === "none") return null;

  let assignee: string | null = null;

  if (strategy === "matrix") {
    assignee = await resolveFromMatrix(tx, tenantId, roleRef, context ?? {});
  } else if (strategy === "authority_chain") {
    assignee = await resolveAuthorityChain(tx, tenantId, roleRef, assignRef, context);
  } else {
    const members = await activeMembersTx(tx, tenantId, roleRef);
    if (members.length === 0) return null;

    if (strategy === "hierarchy") {
      const reporting = assignRef ? members.filter((m) => m.reportsTo === assignRef) : members;
      const pool = reporting.length > 0 ? reporting : members;
      assignee = await nextRoundRobin(tx, tenantId, roleRef, pool);
    } else if (strategy === "least_loaded") {
      assignee = await leastLoaded(tx, tenantId, roleRef, members);
    } else {
      // default: round_robin
      assignee = await nextRoundRobin(tx, tenantId, roleRef, members);
    }
  }

  if (!assignee) return null;

  // Substitution check: if the resolved user has an active substitute, use them instead.
  const today = new Date().toISOString().slice(0, 10);
  const substitute = await findActiveSubstitute(tx, tenantId, assignee, today);
  return substitute ?? assignee;
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

/**
 * Authority chain strategy: walk up reports_to N levels from a starting user.
 * assignRef = the number of levels to climb (e.g., "2" = grandparent manager).
 * Start from context.creatorId if available, otherwise the first role member.
 */
async function resolveAuthorityChain(
  tx: Writer,
  tenantId: string,
  roleRef: string,
  assignRef: string | null | undefined,
  context?: Record<string, unknown>,
): Promise<string | null> {
  const levels = Math.max(1, parseInt(assignRef ?? "1", 10) || 1);
  const members = await activeMembersTx(tx, tenantId, roleRef);
  if (members.length === 0) return null;

  // Determine starting user: prefer context.creatorId, then first member
  const startUserId = (context?.creatorId as string) ?? members[0]?.userId;
  if (!startUserId) return null;

  // Walk up the reports_to chain N levels
  let currentId: string | null = startUserId;
  for (let i = 0; i < levels; i++) {
    const member = members.find((m) => m.userId === currentId);
    if (!member?.reportsTo) break;
    currentId = member.reportsTo;
  }

  // Return the resolved manager (if we moved up), otherwise null
  return currentId !== startUserId ? currentId : null;
}
