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
        await tx.execute(sql`
          UPDATE crm.agent_workload
          SET ${setClause}, version = version + 1
          WHERE agent_id = ${p.agentId} AND tenant_id = ${p.tenantId}
        `);
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "crm", action: "agent_capacity_update", resourceType: "agent_workload", resourceId: p.agentId, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateAgentCapacity failed");
      throw err;
    }
  });
}
