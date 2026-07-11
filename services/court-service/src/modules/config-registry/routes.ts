import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  configIdParam, namespaceParam, setConfigBody, deactivateConfigBody,
} from "./validators.js";
import { assertValidNamespace, assertValidKey } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

// Config is administrative metadata: only court admins may write it. Reads are
// open to the operational roles that consume config-driven enums/rules.
const CONFIG_WRITE_ROLES = ["court_admin", "super_admin"];
const CONFIG_READ_ROLES = ["court_admin", "super_admin", "registrar", "judge", "court_clerk"];

export async function configRoutes(app: FastifyInstance): Promise<void> {
  // Set (create or version-guarded update) a config entry.
  app.post("/v1/court/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_WRITE_ROLES);
    const body = setConfigBody.parse(req.body);
    const result = await commands.setConfig(ctx, body);
    return reply.code(202).send(result);
  });

  // List a namespace's entries. `?active=true` filters to active-only.
  app.get("/v1/court/config/:namespace", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_READ_ROLES);
    const { namespace } = namespaceParam.parse(req.params);
    assertValidNamespace(namespace);
    const activeOnly = (req.query as { active?: string }).active === "true";
    const items = await repo.listByNamespace(ctx.tenantId, namespace, activeOnly);
    return reply.send({ items, count: items.length, source: "db" });
  });

  // Get ONE entry by (namespace, key). Keys may contain dots, so key is a query
  // param (not a path segment) to avoid ambiguous route matching.
  app.get("/v1/court/config-entry", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_READ_ROLES);
    const q = req.query as { namespace?: string; key?: string };
    const namespace = namespaceParam.parse({ namespace: q.namespace }).namespace;
    assertValidNamespace(namespace);
    assertValidKey(q.key ?? "");
    const item = await repo.getConfig(ctx.tenantId, namespace, q.key ?? "");
    if (!item) throw new HttpError(404, "CONFIG_NOT_FOUND", `no config ${namespace}/${q.key}`);
    return reply.send({ item, source: "db" });
  });

  // Deactivate (soft-retire) a config entry by id.
  app.patch("/v1/court/config/:id/deactivate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_WRITE_ROLES);
    const { id } = configIdParam.parse(req.params);
    const body = deactivateConfigBody.parse(req.body);
    const result = await commands.deactivateConfig(ctx, id, body);
    return reply.code(202).send(result);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "config route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
