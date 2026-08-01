import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { caseIdParam, submitFilingBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import type { FilingRow } from "./repo.js";

const FILING_WRITE_ROLES = ["registrar", "court_admin", "super_admin"];
const FILING_READ_ROLES = ["registrar", "court_admin", "judge", "court_clerk", "super_admin"];

/** Serialize a row for the wire: fee amounts as STRINGS (BigInt is not JSON-serialisable). */
function serializeFiling(r: FilingRow): Record<string, unknown> {
  return {
    ...r,
    filingFeeMinor: r.filingFeeMinor.toString(),
    courtFeeMinor: r.courtFeeMinor.toString(),
  };
}

export async function filingRoutes(app: FastifyInstance): Promise<void> {
  // Submit a filing on a case.
  app.post("/v1/court/cases/:id/filings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FILING_WRITE_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const body = submitFilingBody.parse(req.body);
    const result = await commands.submitFiling(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List a case's filings. Fee amounts are serialized as strings (BigInt → string).
  app.get("/v1/court/cases/:id/filings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FILING_READ_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const rows = await repo.listFilingsByCase(ctx.tenantId, id);
    const items = rows.map(serializeFiling);
    return reply.send({ items, count: items.length, source: "db" });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "filing route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
