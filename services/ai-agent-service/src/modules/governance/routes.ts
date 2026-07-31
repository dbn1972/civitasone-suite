import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";

const ROLES = ["ai_admin", "audit_officer", "super_admin"];

export async function governanceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/ai/governance/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({
      data: {
        totalInvocations: 0,
        blockedCount: 0,
        guardrailTriggered: 0,
        activeAgents: 0,
      },
    });
  });

  app.get("/v1/ai/governance/audit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 50, total: 0 } });
  });
}
