import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

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

  queue.subscribe(COMMANDS.updateAgentCapacity, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; agentId: string; maxLeads?: number; available?: boolean; onLeave?: boolean };
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
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateAgentCapacity failed");
      throw err;
    }
  });
}
