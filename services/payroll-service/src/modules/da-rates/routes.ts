/**
 *  GET    /v1/payroll/da-rates       the tenant's effective-dated Dearness Allowance series (+ the rate in force today)
 *  POST   /v1/payroll/da-rates       record a DA revision (payroll_admin / super_admin; audited; 409 on a duplicate effective date)
 *  DELETE /v1/payroll/da-rates/:id   remove a rate (409 once a processed payroll run uses it)
 *
 * Payroll fails with DA_RATE_NOT_CONFIGURED until a tenant has at least one row.
 * Writes are CQRS commands (202) applied by consumer.ts; the checks that give the
 * admin an immediate answer (duplicate date, rate in use) are repeated there.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { createDaRateBody } from "./api.js";
import * as commands from "./commands.js";
import { loadDaRates, processedMonthsUsingRate } from "./rules.js";

const READ_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];
const WRITE_ROLES = ["payroll_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

export async function daRateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/da-rates", async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const rows = await scopedRead((tx) => loadDaRates(tx as never, ctx.tenantId));
    const today = new Date().toISOString().slice(0, 10);
    const current = [...rows].reverse().find((r) => r.effectiveFrom <= today) ?? null;
    return reply.send({ data: rows, current, meta: { total: rows.length } });
  });

  app.post("/v1/payroll/da-rates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createDaRateBody.parse(req.body);
    const existing = await scopedRead((tx) => loadDaRates(tx as never, ctx.tenantId));
    if (existing.some((r) => r.effectiveFrom === body.effectiveFrom)) {
      throw new HttpError(409, "DA_RATE_EXISTS_FOR_DATE", `a DA rate already takes effect on ${body.effectiveFrom}`);
    }
    return reply.code(202).send(await commands.createDaRate(ctx, body));
  });

  app.delete("/v1/payroll/da-rates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const used = await scopedRead(async (tx) => {
      const all = await loadDaRates(tx as never, ctx.tenantId);
      const rate = all.find((r) => r.id === id);
      if (!rate) throw new HttpError(404, "NOT_FOUND", "DA rate not found");
      return processedMonthsUsingRate(tx as never, ctx.tenantId, rate, all);
    });
    if (used.length > 0) {
      throw new HttpError(409, "DA_RATE_IN_USE", `this DA rate is used by processed payroll for ${used.join(", ")} and cannot be deleted`);
    }
    return reply.code(202).send(await commands.deleteDaRate(ctx, id));
  });
}
