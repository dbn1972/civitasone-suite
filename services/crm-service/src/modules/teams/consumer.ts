import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { cache } from "../../shared/infra.js";

async function invalidateScopedLists(tenantId: string): Promise<void> {
  for (const r of ["contact", "deal", "account"]) await cache.invalidateResource(tenantId, r);
}

const log = pino({ name: "crm-teams-consumer" });
const AUDIT = "audit.event.record";

export function registerTeamConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createTeam, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name: string; territory: Record<string, unknown> };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.teams (id, tenant_id, name, territory)
          VALUES (${p.id}, ${p.tenantId}, ${p.name}, ${JSON.stringify(p.territory)}::jsonb)
        `);
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "crm", action: "team_create", resourceType: "team", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createTeam failed");
      throw err;
    }
  });

  // Team membership drives crm_user record visibility, so a change must drop the cached,
  // owner-scoped list pages (contacts / deals / accounts) for the tenant.
  queue.subscribe(COMMANDS.addTeamMember, async (msg) => {
    const p = msg.payload as { teamId: string; userId: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // The team must exist in this tenant (RLS + explicit tenant predicate); a vanished
        // team is a no-op audited as such rather than an FK error that redelivers forever.
        const found = (await tx.execute(sql`
          SELECT 1 FROM crm.teams WHERE id = ${p.teamId} AND tenant_id = ${p.tenantId}
        `)) as unknown as Array<unknown>;
        let outcome = "success";
        if (found.length === 0) outcome = "team_not_found";
        else {
          await tx.execute(sql`
            INSERT INTO crm.team_members (tenant_id, team_id, user_id, added_by)
            VALUES (${p.tenantId}, ${p.teamId}, ${p.userId}, ${msg.actorId})
            ON CONFLICT (team_id, user_id) DO NOTHING
          `);
        }
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "crm", action: "team_member_add", resourceType: "team", resourceId: p.teamId, outcome, metadata: { userId: p.userId } },
        });
      });
      await invalidateScopedLists(msg.tenantId);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "addTeamMember failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.removeTeamMember, async (msg) => {
    const p = msg.payload as { teamId: string; userId: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          DELETE FROM crm.team_members
          WHERE team_id = ${p.teamId} AND user_id = ${p.userId} AND tenant_id = ${p.tenantId}
        `);
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "crm", action: "team_member_remove", resourceType: "team", resourceId: p.teamId, outcome: "success", metadata: { userId: p.userId } },
        });
      });
      await invalidateScopedLists(msg.tenantId);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "removeTeamMember failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.updateAgentCapacity, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; agentId: string; maxLeads?: number; available?: boolean; onLeave?: boolean; reason?: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Build the SET clause from whichever fields were supplied (route guarantees
        // at least one), so maxLeads / available / on_leave can be set independently.
        const parts = [];
        if (p.maxLeads !== undefined) parts.push(sql`max_leads = ${p.maxLeads}`);
        if (p.available !== undefined) parts.push(sql`available = ${p.available}`);
        if (p.onLeave !== undefined) parts.push(sql`on_leave = ${p.onLeave}`);
        const setClause = sql.join(parts, sql`, `);
        // The workload row can disappear between the route's existence check and
        // this apply, so the audit records what actually happened rather than
        // assuming the update landed.
        const updated = (await tx.execute(sql`
          UPDATE crm.agent_workload
          SET ${setClause}, version = version + 1
          WHERE agent_id = ${p.agentId} AND tenant_id = ${p.tenantId}
          RETURNING agent_id
        `)) as unknown as Array<unknown>;
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "crm", action: "agent_capacity_update", resourceType: "agent_workload", resourceId: p.agentId,
            outcome: updated.length > 0 ? "success" : "rejected_agent_not_found",
            // GAP-CRM-AGENT-WORKLOAD-04: capture the change reason (and the new
            // values) so a routing change has a visible audit trail with the
            // actor's justification. Null when the caller sent none.
            metadata: {
              reason: p.reason ?? null,
              ...(p.maxLeads !== undefined ? { maxLeads: p.maxLeads } : {}),
              ...(p.available !== undefined ? { available: p.available } : {}),
              ...(p.onLeave !== undefined ? { onLeave: p.onLeave } : {}),
            },
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateAgentCapacity failed");
      throw err;
    }
  });
}
