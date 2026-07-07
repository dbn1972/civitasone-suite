import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createVersionBody, contractIdParam, versionParam, versionListQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const VERSION_WRITE_ROLES = ["procurement_admin", "finance_admin", "super_admin", "legal_officer", "contract_admin"];
const VERSION_READ_ROLES = [...VERSION_WRITE_ROLES, "audit_officer", "procurement_officer", "finance_officer"];

export async function versionRoutes(app: FastifyInstance): Promise<void> {
  // ── Create new version ────────────────────────────────────────────────
  app.post("/v1/contract/contracts/:id/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VERSION_WRITE_ROLES);
    const { id } = contractIdParam.parse(req.params);
    const body = createVersionBody.parse(req.body);

    const result = await commands.createVersion(ctx, id, body);
    return reply.code(201).send(result);
  });

  // ── List versions ─────────────────────────────────────────────────────
  app.get("/v1/contract/contracts/:id/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VERSION_READ_ROLES);
    const { id } = contractIdParam.parse(req.params);
    const q = versionListQuery.parse(req.query);

    const { data, total } = await queries.listVersions(id, ctx.tenantId, {
      limit: q.limit,
      offset: q.offset,
    });

    return reply.send({
      data,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ── Get redlines for a specific version ───────────────────────────────
  app.get("/v1/contract/contracts/:id/versions/:vn/redlines", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VERSION_READ_ROLES);
    const { id, vn } = versionParam.parse(req.params);

    // Verify version exists
    const version = await queries.getVersionByNumber(id, ctx.tenantId, vn);
    if (!version) {
      throw new HttpError(404, "NOT_FOUND", `version ${vn} not found for contract`);
    }

    const data = await queries.getRedlines(id, ctx.tenantId, vn);
    return reply.send({ data });
  });

  // ── Error handler ─────────────────────────────────────────────────────
  app.setErrorHandler((err: unknown, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      void reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    if (err instanceof HttpError) {
      void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
      return;
    }
    req.log.error({ err }, "unhandled error");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
