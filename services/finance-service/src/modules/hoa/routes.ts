import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { parseHoA, validateHoA, HoaError } from "../../shared/hoa.js";
import * as repo from "./repo.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];

export async function hoaRoutes(app: FastifyInstance): Promise<void> {
  // List CGA major-head master
  app.get("/v1/finance/major-heads", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await repo.listMajorHeads();
    return reply.send({
      data: rows.map((r) => ({
        code: r.code,
        description: r.description,
        sector: r.sector,
        accountType: r.accountType,
      })),
    });
  });

  // Validate / parse an 18-digit HoA code (well-formed + major head exists)
  app.get("/v1/finance/hoa/validate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { code } = z.object({ code: z.string() }).parse(req.query);

    if (!validateHoA(code)) {
      let message = "malformed head of account";
      try {
        parseHoA(code);
      } catch (e) {
        if (e instanceof HoaError) message = e.message;
      }
      return reply.send({ valid: false, reason: message });
    }
    const segments = parseHoA(code);
    const majorHeadKnown = await repo.majorHeadExists(segments.majorHead);
    return reply.send({
      valid: majorHeadKnown,
      ...(majorHeadKnown ? {} : { reason: `major head ${segments.majorHead} not in master` }),
      segments,
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HoaError) {
      return reply.code(400).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
