/**
 * UAT P3 b19 D-15: the effective TDS deductor (Form 16 / 24Q / 26Q / 12BA), read-only.
 *
 *   GET /v1/payroll/settings/deductor -> { source: "documentIdentity" | "env" | null,
 *       name, tan, pan, address, deductorCategory, configured, problems[] }
 *
 * The deductor is configured in tenant-service settings.documentIdentity (shared
 * with the official documents of PR #2463); payroll no longer stores its own copy.
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { resolveDeductor } from "./repo.js";

const READ_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];

export async function deductorConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/settings/deductor", async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return resolveDeductor(ctx.tenantId);
  });
}
