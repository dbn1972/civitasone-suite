/**
 * meeting-service: config-registry HTTP routes.
 *
 * Admin CRUD for the tenant-scoped config/metadata store, plus vertical-preset
 * application. Follows the route → zod validate → publish → 202 CQRS convention.
 * Writes are restricted to tenant/super admins; reads are additionally open to
 * meeting_admin (who operate the policies these keys govern). Mirrors
 * court/visitor config-registry routes.
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  configIdParam, namespaceParam, setConfigBody, deactivateConfigBody,
} from "./validators.js";
import { assertValidNamespace, assertValidKey } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import * as presets from "./presets.js";

// Config is administrative metadata: only tenant/super admins may write it.
const CONFIG_WRITE_ROLES = ["tenant_admin", "super_admin"];
// Reads also open to meeting_admin, who tune the operational policies.
const CONFIG_READ_ROLES = ["tenant_admin", "super_admin", "meeting_admin"];

export async function configRegistryRoutes(app: FastifyInstance): Promise<void> {
  // Set (create or version-guarded update) a config entry.
  app.post("/v1/meetings/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_WRITE_ROLES);
    const body = setConfigBody.parse(req.body);
    const result = await commands.setConfig(ctx, body);
    return reply.code(202).send(result);
  });

  // List a namespace's entries. `?active=true` filters to active-only.
  app.get("/v1/meetings/config/:namespace", async (req, reply) => {
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
  app.get("/v1/meetings/config-entry", async (req, reply) => {
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

  // Apply a VERTICAL PRESET (onboarding): seed the tenant's policy for a vertical
  // (board-of-directors | statutory-committee | municipal-council) in one call.
  app.post("/v1/meetings/config/presets/:preset", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_WRITE_ROLES);
    const preset = (req.params as { preset: string }).preset;
    const result = await presets.applyPreset(ctx, preset);
    return reply.code(202).send(result);
  });

  // Deactivate (soft-retire) a config entry by id.
  app.patch("/v1/meetings/config/:id/deactivate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_WRITE_ROLES);
    const { id } = configIdParam.parse(req.params);
    const body = deactivateConfigBody.parse(req.body);
    const result = await commands.deactivateConfig(ctx, id, body);
    return reply.code(202).send(result);
  });
}
