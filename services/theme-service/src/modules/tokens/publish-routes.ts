import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as revisionRepo from "./revision-repo.js";

// NOTE (documented CQRS exception): unlike the token/branding/template writes (route -> command
// -> consumer with markProcessed), publish is synchronous on purpose. The caller needs the new
// version in the response and a 409 STALE_REVISION when its expectedVersion is out of date,
// neither of which an async 202 command can return. Integrity comes from the per-tenant
// advisory lock + partial unique index on (tenant_id, version) in revision-repo.publish, and
// the audit event is enqueued in the same transaction. A client retry therefore creates a new
// revision only when it omits expectedVersion; with it, the retry gets 409.
//
// GAP-THEMES-HOME-01 / GAP-THEMES-TOKENS-02: publishing a theme is a
// tenant-wide, irreversible visual change, so it is restricted to theme
// admins (NOT the wider theme_user set the token read/list endpoints allow).
const PUBLISH_ROLES = ["theme_admin", "super_admin"];

const publishBody = z.object({
  name: z.string().min(1).max(160),
  // A reason is MANDATORY for the audit trail (maker-checker evidence); the UI
  // already requires it, and the server enforces it independently.
  reason: z.string().min(1).max(1000),
  // Optional optimistic-concurrency guard: the version the client believed was
  // current. When present and stale, the publish is rejected with 409.
  expectedVersion: z.number().int().nonnegative().optional(),
});

export async function publishRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/themes/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PUBLISH_ROLES);
    const body = publishBody.parse(req.body);
    try {
      const revision = await revisionRepo.publish({
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        name: body.name,
        reason: body.reason,
        ...(body.expectedVersion !== undefined ? { expectedVersion: body.expectedVersion } : {}),
      });
      return reply.code(201).send(revision);
    } catch (err) {
      if (err instanceof revisionRepo.StaleRevisionError) {
        throw new HttpError(409, "STALE_REVISION", err.message);
      }
      if (revisionRepo.isVersionConflict(err)) {
        throw new HttpError(409, "STALE_REVISION", "a theme revision was published concurrently; reload and retry");
      }
      throw err;
    }
  });

  app.get("/v1/themes/revisions/latest", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PUBLISH_ROLES);
    const latest = await revisionRepo.latestPublished(ctx.tenantId);
    return reply.send(latest ?? null);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
