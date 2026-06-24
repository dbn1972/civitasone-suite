import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  issueInstrumentBody,
  bounceInstrumentBody,
  listInstrumentsQuery,
  idParam,
} from "./validators.js";
import * as commands from "./commands.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES  = [...FINANCE_ROLES, "audit_officer"];

/**
 * Cheque / DD payment instruments — issuance + tenant-scoped status lifecycle
 * (issued -> presented -> cleared | bounced | cancelled). All transitions are
 * idempotent and guarded by an atomic conditional UPDATE in the repo.
 */
export async function instrumentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/finance/instruments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = issueInstrumentBody.parse(req.body);
    const view = await commands.issueInstrument(ctx, body);
    return reply.code(201).send(view);
  });

  app.get("/v1/finance/instruments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listInstrumentsQuery.parse(req.query);
    const data = await commands.listInstruments(ctx, {
      limit: q.limit,
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
    });
    return reply.send({ data, pagination: { hasMore: data.length === q.limit, pageSize: q.limit } });
  });

  app.get("/v1/finance/instruments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await commands.getInstrument(ctx, id));
  });

  app.post("/v1/finance/instruments/:id/present", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await commands.presentInstrument(ctx, id));
  });

  app.post("/v1/finance/instruments/:id/clear", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await commands.clearInstrument(ctx, id));
  });

  app.post("/v1/finance/instruments/:id/bounce", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = bounceInstrumentBody.parse(req.body ?? {});
    return reply.send(await commands.bounceInstrument(ctx, id, body));
  });

  app.post("/v1/finance/instruments/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await commands.cancelInstrument(ctx, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
