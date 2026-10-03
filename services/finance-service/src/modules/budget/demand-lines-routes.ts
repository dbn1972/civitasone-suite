import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import {
  findDemandForTenant, listDemandLines, findMajorHeadsByCode, assertDemandLinesValid, assertDemandEditable,
  DemandLinesError, type DemandLineInput,
} from "./demand-lines.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer", "procurement_officer"];
const idParam = z.object({ id: z.string().uuid() });
const setLinesBody = z.object({
  lines: z.array(z.object({
    headCode: z.string().trim().min(1).max(20),
    amountMinor: z.string().regex(/^\d{1,18}$/, "amountMinor must be a whole number of paise"),
  })).min(1).max(100),
});

function asHttp(err: unknown): never {
  if (err instanceof DemandLinesError) throw new HttpError(err.code === "NOT_FOUND" ? 404 : 400, err.code, err.message);
  throw err;
}

/** Demand-for-grants drill-down: one demand with its head-wise lines, and the editor for those lines. */
export async function demandLinesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/budgets/demand-grants/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const demand = await findDemandForTenant(ctx.tenantId, id);
    if (!demand) throw new HttpError(404, "NOT_FOUND", "demand not found");
    const lines = await listDemandLines(ctx.tenantId, id);
    const linesTotal = lines.reduce((s, l) => s + l.amountMinor, 0n);
    return reply.send({
      data: {
        id: demand.id, demandNo: demand.demandNo, service: demand.service,
        amountMinor: demand.amountMinor.toString(), currency: demand.currency, class: demand.class, status: demand.status,
        createdAt: demand.createdAt.toISOString(), updatedAt: demand.updatedAt.toISOString(),
        lines: lines.map((l) => ({ id: l.id, headCode: l.headCode, headName: l.headName, amountMinor: l.amountMinor.toString() })),
        linesTotalMinor: linesTotal.toString(),
        // true once the head-wise split reconciles to the demand amount.
        linesReconciled: lines.length > 0 && linesTotal === demand.amountMinor,
      },
    });
  });

  app.put("/v1/finance/budgets/demand-grants/:id/lines", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = setLinesBody.parse(req.body);
    const demand = await findDemandForTenant(ctx.tenantId, id);
    if (!demand) throw new HttpError(404, "NOT_FOUND", "demand not found");
    const lines: DemandLineInput[] = body.lines.map((l) => ({ headCode: l.headCode, amountMinor: BigInt(l.amountMinor) }));
    try {
      assertDemandEditable(demand.status);
      assertDemandLinesValid(demand.amountMinor, lines);
      const heads = await findMajorHeadsByCode(ctx.tenantId, lines.map((l) => l.headCode));
      const known = new Set(heads.map((h) => h.code));
      const unknown = lines.find((l) => !known.has(l.headCode));
      if (unknown) throw new DemandLinesError("UNKNOWN_HEAD", `${unknown.headCode} is not a major head`);
    } catch (err) {
      asHttp(err);
    }
    await queue.publish(COMMANDS.demandLinesSet, {
      messageId: randomUUID(), type: COMMANDS.demandLinesSet,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { tenantId: ctx.tenantId, demandId: id, lines: body.lines },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.setErrorHandler(financeErrorHandler);
}
