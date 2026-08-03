/**
 * CAP-052 — API catalogue routes (gateway-native, DB civitas_gateway).
 *
 * GET    /api/v1/catalogue               list (filter: status, module)
 * GET    /api/v1/catalogue/:id           get one + changelog
 * POST   /api/v1/catalogue               register → queue → 202
 * POST   /api/v1/catalogue/:id/deprecate lifecycle → queue → 202
 * POST   /api/v1/catalogue/:id/lifecycle lifecycle → queue → 202
 * POST   /api/v1/catalogue/seed          seed → queue → 202
 *
 * Reads use withTenant() (FORCE-RLS via app.tenant_id GUC).
 * Writes are CQRS: validate → publish → 202; consumer applies under RLS.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "./context.js";
import { withTenant } from "../../shared/scope.js";
import * as repo from "./repo.js";
import type { ApiEntryRow, ApiChangelogRow } from "./schema.js";
import { applyLifecycle, type ApiAction, type ApiStatus } from "./domain.js";
import * as commands from "./commands.js";

const ADMIN_ROLES = ["super_admin", "platform_admin", "api_admin"];

const registerBody = z.object({
  name: z.string().min(1).max(120),
  module: z.string().min(1).max(120),
  version: z.string().regex(/^v\d+$/).default("v1"),
  path: z.string().min(1).max(300),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "ANY"]).default("GET"),
  upstream: z.string().max(300).optional(),
  owner: z.string().max(120).optional(),
  description: z.string().max(1000).optional(),
  status: z.enum(["draft", "active"]).default("draft"),
});

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const deprecateBody = z.object({
  deprecationDate: dateStr.optional(),
  sunsetDate: dateStr.optional(),
  note: z.string().max(1000).optional(),
});

const lifecycleBody = z.object({
  action: z.enum(["activate", "deprecate", "retire", "reinstate"]),
  deprecationDate: dateStr.optional(),
  sunsetDate: dateStr.optional(),
  note: z.string().max(1000).optional(),
});

export async function catalogueRoutes(app: FastifyInstance): Promise<void> {
  // ── List ────────────────────────────────────────────────────────────────
  app.get("/api/v1/catalogue", async (req, reply) => {
    const ctx = resolveContext(req);
    const q = z
      .object({
        status: z.enum(["draft", "active", "deprecated", "retired"]).optional(),
        module: z.string().max(120).optional(),
      })
      .parse(req.query);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      repo.listEntries(tx as any, ctx.tenantId, q),
    );
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  // ── Get one + changelog ───────────────────────────────────────────────────
  app.get("/api/v1/catalogue/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await withTenant(
      ctx.tenantId,
      async (tx): Promise<{ entry: ApiEntryRow; changelog: ApiChangelogRow[] } | null> => {
        const entry = await repo.getEntry(tx as any, ctx.tenantId, id);
        if (!entry) return null;
        const changelog = await repo.listChangelog(tx as any, ctx.tenantId, id);
        return { entry, changelog };
      },
    );
    if (!result) throw new HttpError(404, "NOT_FOUND", "api not found");
    return reply.send({ data: result.entry, changelog: result.changelog });
  });

  // ── Register (CQRS) ───────────────────────────────────────────────────────
  app.post("/api/v1/catalogue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = registerBody.parse(req.body);

    const existing = await withTenant(ctx.tenantId, (tx) =>
      repo.findByKey(tx as any, ctx.tenantId, {
        name: body.name,
        version: body.version,
        method: body.method,
        path: body.path,
      }),
    );
    if (existing) {
      throw new HttpError(409, "ALREADY_EXISTS", "an API with this name/version/method/path is already registered");
    }

    const accepted = await commands.registerApi(ctx, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Deprecate (convenience wrapper) ───────────────────────────────────────
  app.post("/api/v1/catalogue/:id/deprecate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = deprecateBody.parse(req.body ?? {});
    const accepted = await enqueueLifecycle(ctx, id, "deprecate", body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Generic lifecycle transition ────────────────────────────────────────────
  app.post("/api/v1/catalogue/:id/lifecycle", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = lifecycleBody.parse(req.body);
    const accepted = await enqueueLifecycle(ctx, id, body.action, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Seed from the live route registry ─────────────────────────────────────
  app.post("/api/v1/catalogue/seed", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["super_admin", "platform_admin"]);
    const accepted = await commands.seedCatalogue(ctx);
    return reply.code(202).send({ data: accepted });
  });

  async function enqueueLifecycle(
    ctx: ReturnType<typeof resolveContext>,
    id: string,
    action: ApiAction,
    opts: { deprecationDate?: string | undefined; sunsetDate?: string | undefined; note?: string | undefined },
  ) {
    const entry = await withTenant(ctx.tenantId, (tx) => repo.getEntry(tx as any, ctx.tenantId, id));
    if (!entry) throw new HttpError(404, "NOT_FOUND", "api not found");
    try {
      applyLifecycle(entry.status as ApiStatus, action);
    } catch (err) {
      throw new HttpError(409, "INVALID_TRANSITION", (err as Error).message);
    }
    return commands.lifecycleApi(ctx, id, action, opts);
  }

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    }
    req.log.error({ err }, "unhandled");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
