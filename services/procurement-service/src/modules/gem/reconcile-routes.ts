import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./reconcile-commands.js";
import * as repo from "./reconcile-repo.js";
import { isIntegrationConfigured } from "./integration-adapter.js";
import { PROVIDERS, type Provider } from "./reconcile-domain.js";
import { exchangeBody, refIdParam } from "./reconcile-validators.js";

const WRITE_ROLES  = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...WRITE_ROLES, "audit_officer", "finance_officer"];

export async function gemReconcileRoutes(app: FastifyInstance): Promise<void> {
  /** Honest health/config probe — reports which providers are configured. */
  app.get("/v1/procurement/gem/integration/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const providers = Object.fromEntries(PROVIDERS.map((p) => [p, isIntegrationConfigured(p as Provider)]));
    return reply.send({ data: { providers } });
  });

  app.post("/v1/procurement/gem/integration/exchange", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = exchangeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.exchange(ctx, body));
  });

  app.post("/v1/procurement/gem/integration/refs/:id/reconcile", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = refIdParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.reconcileRef(ctx, id));
  });

  app.get("/v1/procurement/gem/integration/refs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listRefsByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows });
  });

  app.get("/v1/procurement/gem/integration/refs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = refIdParam.parse(req.params);
    const ref = await repo.findRefById(id, ctx.tenantId);
    if (!ref) throw new HttpError(404, "NOT_FOUND", "integration ref not found");
    return reply.send({ data: ref });
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: err.status === 503 });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
