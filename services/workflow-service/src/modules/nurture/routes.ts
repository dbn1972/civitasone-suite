/**
 * Gap 3 — Nurture workflow template rules.
 *
 * GET  /v1/workflow/nurture-rules  — list configured rules
 * POST /v1/workflow/nurture-rules  — create a new rule
 */
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { createNurtureRuleBody } from "./validators.js";

const ROLES = ["workflow_admin", "crm_admin", "super_admin"];

interface NurtureRuleRow {
  id: string;
  tenantId: string;
  triggerType: string;
  threshold: number;
  templateId: string;
  channel: string;
  enabled: boolean;
  createdAt: string;
}

export async function nurtureRoutes(app: FastifyInstance): Promise<void> {
  // List nurture rules
  app.get("/v1/workflow/nurture-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT id, tenant_id AS "tenantId", trigger_type AS "triggerType",
             threshold, template_id AS "templateId", channel, enabled,
             created_at AS "createdAt"
      FROM workflow.nurture_rules
      WHERE tenant_id = ${ctx.tenantId}
      ORDER BY created_at DESC
      LIMIT 200
    `)) as unknown as NurtureRuleRow[];

    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  // Create nurture rule
  app.post("/v1/workflow/nurture-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createNurtureRuleBody.parse(req.body);

    const id = randomUUID();
    await scopedRead(async (tx) => {
      await tx.execute(sql`
        INSERT INTO workflow.nurture_rules (id, tenant_id, trigger_type, threshold, template_id, channel, enabled, created_by)
        VALUES (${id}, ${ctx.tenantId}, ${body.triggerType}, ${body.threshold},
                ${body.templateId}, ${body.channel}, ${body.enabled ?? true}, ${ctx.actorId})
      `);
    });

    return reply.code(201).send({ data: { id } });
  });
}
