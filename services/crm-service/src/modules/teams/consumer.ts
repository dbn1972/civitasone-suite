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
    const p = msg.payload as { id: string; tenantId: string; agentId: string; maxLeads?: number; available?: boolean };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const setClause = p.maxLeads !== undefined && p.available !== undefined
          ? sql`max_leads = ${p.maxLeads}, available = ${p.available}`
          : p.maxLeads !== undefined
            ? sql`max_leads = ${p.maxLeads}`
            : sql`available = ${p.available!}`;
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
