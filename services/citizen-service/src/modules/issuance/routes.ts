import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, resolvePublicContext, HttpError } from "../../shared/context.js";
import { idParam, tokenParam, requestIssuanceBody, amendBody, renewBody, revokeBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];

export async function issuanceRoutes(app: FastifyInstance): Promise<void> {
  // --- Public QR verify (no auth) ---------------------------------------------
  app.get("/v1/citizen/certificates/verify/:token", { config: { public: true } }, async (req, reply) => {
    resolvePublicContext(req, "00000000-0000-4000-8000-000000000000");
    const { token } = tokenParam.parse(req.params);
    const result = await queries.verifyByToken(token);
    if (!result.found) return reply.code(404).send({ found: false, validity: "invalid" });
    return reply.send(result);
  });

  // --- Maker-checker issuance --------------------------------------------------
  app.post("/v1/citizen/certificates/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = requestIssuanceBody.parse(req.body);
    return reply.code(202).send(await commands.requestIssuance(ctx, body));
  });

  app.post("/v1/citizen/certificates/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.code(202).send(await commands.approveIssuance(ctx, id));
  });

  app.get("/v1/citizen/certificates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    return reply.send({ data: await queries.listCertificates(ctx.tenantId) });
  });

  app.get("/v1/citizen/certificates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const cert = await queries.getCertificate(ctx.tenantId, id);
    if (!cert) throw new HttpError(404, "NOT_FOUND", "certificate not found");
    return reply.send(cert);
  });

  // --- Lifecycle: amend / renew / cancel / revoke -----------------------------
  app.post("/v1/citizen/certificates/:id/amend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = amendBody.parse(req.body);
    return reply.code(202).send(await commands.amendCertificate(ctx, id, body));
  });

  app.post("/v1/citizen/certificates/:id/renew", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = renewBody.parse(req.body);
    return reply.code(202).send(await commands.renewCertificate(ctx, id, body));
  });

  app.post("/v1/citizen/certificates/:id/revoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = revokeBody.parse(req.body);
    return reply.code(202).send(await commands.revokeCertificate(ctx, id, body));
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
