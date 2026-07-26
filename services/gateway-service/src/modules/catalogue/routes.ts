/**
 * CAP-052 — API catalogue routes (gateway-native, DB civitas_gateway).
 *
 * GET    /api/v1/catalogue               list (filter: status, module)
 * GET    /api/v1/catalogue/:id           get one + changelog
 * POST   /api/v1/catalogue               register a new API surface
 * POST   /api/v1/catalogue/:id/deprecate deprecate (dates + note)
 * POST   /api/v1/catalogue/:id/lifecycle generic transition (activate/retire/reinstate/deprecate)
 * POST   /api/v1/catalogue/seed          seed from the live gateway route registry
 *
 * Every DB op runs inside withTenantScope() so FORCE-RLS is satisfied by the
 * app.tenant_id GUC (gateway_svc is NOBYPASSRLS).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { withTenantScope } from "@civitasone/db";
import { resolveContext, requireRole, HttpError } from "./context.js";
import { db } from "./db.js";
import * as repo from "./repo.js";
import type { ApiEntryRow, ApiChangelogRow } from "./schema.js";
import { seedFromRegistry } from "./seed.js";
import { applyLifecycle, changeTypeForAction, type ApiAction, type ApiStatus } from "./domain.js";

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
    const rows = await withTenantScope<unknown, ApiEntryRow[]>(db, ctx.tenantId, (tx) =>
      repo.listEntries(tx as any, ctx.tenantId, q),
    );
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  // ── Get one + changelog ───────────────────────────────────────────────────
  app.get("/api/v1/catalogue/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await withTenantScope<unknown, { entry: ApiEntryRow; changelog: ApiChangelogRow[] } | null>(
      db,
      ctx.tenantId,
      async (tx) => {
        const entry = await repo.getEntry(tx as any, ctx.tenantId, id);
        if (!entry) return null;
        const changelog = await repo.listChangelog(tx as any, ctx.tenantId, id);
        return { entry, changelog };
      },
    );
    if (!result) throw new HttpError(404, "NOT_FOUND", "api not found");
    return reply.send({ data: result.entry, changelog: result.changelog });
  });

  // ── Register ───────────────────────────────────────────────────────────────
  app.post("/api/v1/catalogue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = registerBody.parse(req.body);

    const row = await withTenantScope<unknown, ApiEntryRow>(db, ctx.tenantId, async (tx) => {
      const existing = await repo.findByKey(tx as any, ctx.tenantId, {
        name: body.name,
        version: body.version,
        method: body.method,
        path: body.path,
      });
      if (existing) {
        throw new HttpError(409, "ALREADY_EXISTS", "an API with this name/version/method/path is already registered");
      }
      const created = await repo.upsertEntry(tx as any, {
        tenantId: ctx.tenantId,
        name: body.name,
        module: body.module,
        version: body.version,
        path: body.path,
        method: body.method,
        status: body.status,
        source: "manual",
        createdBy: ctx.actorId,
        ...(body.upstream ? { upstream: body.upstream } : {}),
        ...(body.owner ? { owner: body.owner } : {}),
        ...(body.description ? { description: body.description } : {}),
      });
      await repo.insertChangelog(tx as any, {
        tenantId: ctx.tenantId,
        apiId: created.id,
        changeType: "registered",
        toStatus: created.status,
        note: "registered via catalogue API",
        actorId: ctx.actorId,
      });
      return created;
    });

    return reply.code(201).send({ data: row });
  });

  // ── Deprecate (convenience wrapper over the lifecycle transition) ───────────
  app.post("/api/v1/catalogue/:id/deprecate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = deprecateBody.parse(req.body ?? {});
    const row = await transition(ctx, id, "deprecate", body);
    return reply.send({ data: row });
  });

  // ── Generic lifecycle transition ────────────────────────────────────────────
  app.post("/api/v1/catalogue/:id/lifecycle", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = lifecycleBody.parse(req.body);
    const row = await transition(ctx, id, body.action, body);
    return reply.send({ data: row });
  });

  // ── Seed from the live route registry (platform bootstrap) ──────────────────
  app.post("/api/v1/catalogue/seed", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["super_admin", "platform_admin"]);
    const result = await withTenantScope<unknown, { total: number; created: number }>(
      db,
      ctx.tenantId,
      (tx) => seedFromRegistry(tx as any, ctx.tenantId, ctx.actorId),
    );
    return reply.send({ data: result });
  });

  // ── shared transition helper ────────────────────────────────────────────────
  async function transition(
    ctx: ReturnType<typeof resolveContext>,
    id: string,
    action: ApiAction,
    opts: { deprecationDate?: string | undefined; sunsetDate?: string | undefined; note?: string | undefined },
  ) {
    return withTenantScope<unknown, ApiEntryRow | undefined>(db, ctx.tenantId, async (tx) => {
      const entry = await repo.getEntry(tx as any, ctx.tenantId, id);
      if (!entry) throw new HttpError(404, "NOT_FOUND", "api not found");
      const from = entry.status as ApiStatus;
      let to: ApiStatus;
      try {
        to = applyLifecycle(from, action);
      } catch (err) {
        throw new HttpError(409, "INVALID_TRANSITION", (err as Error).message);
      }
      const patch: { status: string; deprecationDate?: string | null; sunsetDate?: string | null } = { status: to };
      if (action === "deprecate") {
        patch.deprecationDate = opts.deprecationDate ?? new Date().toISOString().slice(0, 10);
        if (opts.sunsetDate) patch.sunsetDate = opts.sunsetDate;
      }
      const updated = await repo.updateStatus(tx as any, ctx.tenantId, id, patch);
      await repo.insertChangelog(tx as any, {
        tenantId: ctx.tenantId,
        apiId: id,
        changeType: changeTypeForAction(action),
        fromStatus: from,
        toStatus: to,
        note: opts.note ?? null,
        actorId: ctx.actorId,
      });
      return updated;
    });
  }
}
