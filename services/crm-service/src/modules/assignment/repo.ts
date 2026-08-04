/**
 * Reads + transactional write helpers for lead assignment & escalation.
 *
 * Raw SQL (like the teams module) rather than drizzle tables: these are
 * config/log tables read a handful of rows at a time, and keeping them out of the
 * drizzle schema map avoids widening db.ts for tables only this module touches.
 * Every read goes through scopedRead so RLS is enforced on the read path.
 */
import { sql, type SQL } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import type { AssignmentRule, AgentAvailability } from "../leads/assignment.js";
import type { EscalationRuleLike, LeadTimingLike } from "./escalation-domain.js";

type Row = Record<string, unknown>;

/** Drizzle tx handle accepted by the raw-SQL write helpers. The parameter is
 *  typed as drizzle's SQL so a real PgTransaction is assignable here. */
export type Tx = { execute: (q: SQL) => Promise<unknown> };

// ── Assignment rules ─────────────────────────────────────────────────────────

export interface AssignmentRuleView {
  id: string;
  name: string;
  ruleType: string;
  criteria: Record<string, unknown>;
  ordinal: number;
  enabled: boolean;
  fallbackOwnerId: string | null;
  rrCursor: number;
}

function mapRuleRows(rows: Row[]): AssignmentRuleView[] {
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    ruleType: r.ruleType as string,
    criteria: (r.criteria ?? {}) as Record<string, unknown>,
    ordinal: Number(r.ordinal),
    enabled: r.enabled as boolean,
    fallbackOwnerId: (r.fallbackOwnerId ?? null) as string | null,
    rrCursor: Number(r.rrCursor),
  }));
}

/** Route read (own transaction). Column is `type` (from migration 0016). */
export async function listRules(tenantId: string): Promise<AssignmentRuleView[]> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT id, name, type AS "ruleType", criteria, ordinal, enabled,
           fallback_owner_id AS "fallbackOwnerId", rr_cursor AS "rrCursor"
    FROM crm.assignment_rules
    WHERE tenant_id = ${tenantId}
    ORDER BY ordinal ASC, created_at ASC
  `))) as unknown as Row[];
  return mapRuleRows(rows);
}

/** Consumer read — reuses the caller's transaction to avoid nesting. */
export async function listRulesTx(tx: Tx, tenantId: string): Promise<AssignmentRuleView[]> {
  const rows = (await tx.execute(sql`
    SELECT id, name, type AS "ruleType", criteria, ordinal, enabled,
           fallback_owner_id AS "fallbackOwnerId", rr_cursor AS "rrCursor"
    FROM crm.assignment_rules
    WHERE tenant_id = ${tenantId}
    ORDER BY ordinal ASC, created_at ASC
  `)) as unknown as Row[];
  return mapRuleRows(rows);
}

/**
 * Assign-path read that LOCKS the tenant's rule rows (`FOR UPDATE`), so concurrent
 * assignments serialize and the round-robin cursor advances exactly one step per
 * lead. Two simultaneous inbound leads otherwise read the same rr_cursor and both
 * land on the same agent. The lock is released when the assign transaction commits.
 */
export async function listRulesForUpdate(tx: Tx, tenantId: string): Promise<AssignmentRuleView[]> {
  const rows = (await tx.execute(sql`
    SELECT id, name, type AS "ruleType", criteria, ordinal, enabled,
           fallback_owner_id AS "fallbackOwnerId", rr_cursor AS "rrCursor"
    FROM crm.assignment_rules
    WHERE tenant_id = ${tenantId}
    ORDER BY ordinal ASC, created_at ASC
    FOR UPDATE
  `)) as unknown as Row[];
  return mapRuleRows(rows);
}

/**
 * Map a stored rule row to the engine's AssignmentRule. round_robin/capacity
 * criteria carry a `roster`; round_robin also needs the persisted cursor folded
 * into `currentIndex` so cycling resumes where it left off.
 */
export function toEngineRule(v: AssignmentRuleView): AssignmentRule {
  const criteria = { ...v.criteria } as Record<string, unknown>;
  if (v.ruleType === "round_robin") {
    (criteria as { currentIndex?: number }).currentIndex = v.rrCursor;
  }
  return {
    id: v.id,
    type: v.ruleType as AssignmentRule["type"],
    criteria: criteria as unknown as AssignmentRule["criteria"],
    ordinal: v.ordinal,
    enabled: v.enabled,
  };
}

// ── Agent availability snapshot (AS-003) ─────────────────────────────────────

/**
 * Availability for every agent with a workload row, with current_load recomputed
 * live from open-lead ownership counts so a stale counter cannot over-assign a
 * busy agent. Leads that have left the funnel (converted/disqualified) do not
 * count against capacity.
 */
export async function agentAvailability(tx: Tx, tenantId: string): Promise<AgentAvailability[]> {
  const rows = (await tx.execute(sql`
    SELECT w.agent_id AS "ownerId",
           w.available,
           w.on_leave AS "onLeave",
           w.max_leads AS "maxLeads",
           COALESCE(c.load, 0) AS "currentLoad"
    FROM crm.agent_workload w
    LEFT JOIN (
      SELECT owner_id, COUNT(*)::int AS load
      FROM crm.contacts
      WHERE tenant_id = ${tenantId}
        AND status = 'active'
        AND owner_id IS NOT NULL
        AND lead_status NOT IN ('converted', 'disqualified')
      GROUP BY owner_id
    ) c ON c.owner_id = w.agent_id
    WHERE w.tenant_id = ${tenantId}
  `)) as unknown as Row[];
  return rows.map((r) => ({
    ownerId: r.ownerId as string,
    available: r.available as boolean,
    onLeave: r.onLeave as boolean,
    maxLeads: Number(r.maxLeads),
    currentLoad: Number(r.currentLoad),
  }));
}

// ── Lead facts for the engine ────────────────────────────────────────────────

export interface LeadFacts {
  id: string;
  territory: string | null;
  score: number | null;
  product: string | null;
  segment: string | null;
  language: string | null;
  ownerId: string | null;
}

export async function leadFacts(tx: Tx, tenantId: string, leadId: string): Promise<LeadFacts | null> {
  const rows = (await tx.execute(sql`
    SELECT id, region AS "territory", score, product, segment,
           language, owner_id AS "ownerId"
    FROM crm.contacts
    WHERE id = ${leadId} AND tenant_id = ${tenantId} AND status = 'active'
  `)) as unknown as Row[];
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id as string,
    territory: (r.territory ?? null) as string | null,
    score: r.score == null ? null : Number(r.score),
    product: (r.product ?? null) as string | null,
    segment: (r.segment ?? null) as string | null,
    language: (r.language ?? null) as string | null,
    ownerId: (r.ownerId ?? null) as string | null,
  };
}

// ── Writes (all inside the caller's tx) ──────────────────────────────────────

export async function insertAssignmentLog(
  tx: Tx,
  row: {
    tenantId: string;
    leadId: string;
    ownerId: string;
    ruleId: string | null;
    method: "auto" | "manual" | "transfer";
    assignedBy: string;
  },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO crm.lead_assignment_log (tenant_id, lead_id, owner_id, rule_id, method, assigned_by)
    VALUES (${row.tenantId}, ${row.leadId}, ${row.ownerId},
            ${row.ruleId}, ${row.method}, ${row.assignedBy})
  `);
}

/**
 * Apply a new owner + reset accept/escalation state (owner just changed).
 * Returns the number of rows affected so callers can distinguish a real
 * assignment from a no-op on a missing / inactive / other-tenant lead.
 */
export async function applyOwner(
  tx: Tx,
  tenantId: string,
  leadId: string,
  ownerId: string,
  actorId: string,
): Promise<number> {
  const rows = (await tx.execute(sql`
    UPDATE crm.contacts
    SET owner_id = ${ownerId},
        assigned_at = now(),
        accepted_at = NULL,
        escalated_at = NULL,
        updated_at = now(),
        updated_by = ${actorId},
        version = version + 1
    WHERE id = ${leadId} AND tenant_id = ${tenantId} AND status = 'active'
    RETURNING id
  `)) as unknown as Row[];
  return rows.length;
}

export async function persistRoundRobinCursor(
  tx: Tx,
  tenantId: string,
  ruleId: string,
  index: number,
): Promise<void> {
  await tx.execute(sql`
    UPDATE crm.assignment_rules
    SET rr_cursor = ${index}, updated_at = now()
    WHERE id = ${ruleId} AND tenant_id = ${tenantId}
  `);
}

export async function markAccepted(tx: Tx, tenantId: string, leadId: string): Promise<number> {
  const rows = (await tx.execute(sql`
    UPDATE crm.contacts
    SET accepted_at = now(), escalated_at = NULL, updated_at = now()
    WHERE id = ${leadId} AND tenant_id = ${tenantId} AND status = 'active'
    RETURNING id
  `)) as unknown as Row[];
  return rows.length;
}

// ── Escalation reads ─────────────────────────────────────────────────────────

export async function listEscalationRules(tx: Tx, tenantId: string): Promise<EscalationRuleLike[]> {
  const rows = (await tx.execute(sql`
    SELECT id, trigger, threshold_minutes AS "thresholdMinutes", reassign, enabled,
           recipient_role AS "recipientRole", recipient_id AS "recipientId",
           reassign_owner_id AS "reassignOwnerId"
    FROM crm.escalation_rules
    WHERE tenant_id = ${tenantId} AND enabled = true
    ORDER BY threshold_minutes ASC
  `)) as unknown as Row[];
  return rows.map((r) => ({
    id: r.id as string,
    trigger: r.trigger as EscalationRuleLike["trigger"],
    thresholdMinutes: Number(r.thresholdMinutes),
    reassign: r.reassign as boolean,
    enabled: r.enabled as boolean,
    recipientRole: (r.recipientRole ?? null) as string | null,
    recipientId: (r.recipientId ?? null) as string | null,
  }));
}

/** reassignOwnerId is read separately since escalation-domain does not carry it. */
export async function reassignOwnerFor(tx: Tx, tenantId: string, ruleId: string): Promise<string | null> {
  const rows = (await tx.execute(sql`
    SELECT reassign_owner_id AS "reassignOwnerId"
    FROM crm.escalation_rules
    WHERE id = ${ruleId} AND tenant_id = ${tenantId}
  `)) as unknown as Row[];
  return (rows[0]?.reassignOwnerId ?? null) as string | null;
}

/** Candidate leads for escalation: assigned, still open, not yet escalated. */
export async function overdueCandidates(tx: Tx, tenantId: string): Promise<LeadTimingLike[]> {
  const rows = (await tx.execute(sql`
    SELECT id AS "leadId", owner_id AS "ownerId",
           assigned_at AS "assignedAt", accepted_at AS "acceptedAt",
           last_activity_at AS "lastActivityAt"
    FROM crm.contacts
    WHERE tenant_id = ${tenantId}
      AND status = 'active'
      AND assigned_at IS NOT NULL
      AND escalated_at IS NULL
      AND lead_status NOT IN ('converted', 'disqualified')
  `)) as unknown as Row[];
  return rows.map((r) => ({
    leadId: r.leadId as string,
    ownerId: (r.ownerId ?? null) as string | null,
    assignedAt: (r.assignedAt ?? null) as string | null,
    acceptedAt: (r.acceptedAt ?? null) as string | null,
    lastActivityAt: (r.lastActivityAt ?? null) as string | null,
  }));
}

export async function markEscalated(tx: Tx, tenantId: string, leadId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE crm.contacts SET escalated_at = now(), updated_at = now()
    WHERE id = ${leadId} AND tenant_id = ${tenantId} AND status = 'active'
  `);
}

// ── Simple config-table list readers (AS-002) ────────────────────────────────

export async function listTargets(tenantId: string, table: "assignment_queues" | "territories" | "partners" | "branches"): Promise<Row[]> {
  const rel =
    table === "assignment_queues" ? sql`crm.assignment_queues`
    : table === "territories" ? sql`crm.territories`
    : table === "partners" ? sql`crm.partners`
    : sql`crm.branches`;
  return (await scopedRead((tx) =>
    tx.execute(sql`SELECT * FROM ${rel} WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`),
  )) as unknown as Row[];
}

export async function listAssignmentLog(tenantId: string, leadId: string): Promise<Row[]> {
  return (await scopedRead((tx) =>
    tx.execute(sql`
      SELECT id, lead_id AS "leadId", owner_id AS "ownerId", rule_id AS "ruleId",
             method, assigned_at AS "assignedAt", assigned_by AS "assignedBy"
      FROM crm.lead_assignment_log
      WHERE tenant_id = ${tenantId} AND lead_id = ${leadId}
      ORDER BY assigned_at ASC
    `),
  )) as unknown as Row[];
}

export async function listEscalationRuleViews(tenantId: string): Promise<Row[]> {
  return (await scopedRead((tx) =>
    tx.execute(sql`
      SELECT id, name, trigger, threshold_minutes AS "thresholdMinutes",
             recipient_role AS "recipientRole", recipient_id AS "recipientId",
             reassign, reassign_owner_id AS "reassignOwnerId", enabled,
             created_at AS "createdAt", version
      FROM crm.escalation_rules
      WHERE tenant_id = ${tenantId}
      ORDER BY threshold_minutes ASC
    `),
  )) as unknown as Row[];
}

export async function listRuleViews(tenantId: string): Promise<AssignmentRuleView[]> {
  return listRules(tenantId);
}
