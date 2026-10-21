/**
 * visitor-service: config-registry HTTP routes.
 *
 * Admin CRUD for the tenant-scoped config/metadata store, plus vertical-preset
 * application. Follows the route → zod validate → publish → 202 CQRS convention.
 * Writes are restricted to tenant/super admins; reads are additionally open to
 * security_admin (who operate the policies these keys govern). Mirrors
 * court-service/src/modules/config-registry/routes.ts.
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  configIdParam, namespaceParam, setConfigBody, deactivateConfigBody, applyPresetBody,
} from "./validators.js";
import { assertValidNamespace, assertValidKey } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import * as presets from "./presets.js";

// Config is administrative metadata: only tenant/super admins may write it.
const CONFIG_WRITE_ROLES = ["tenant_admin", "super_admin"];
// Reads also open to security_admin, who tune the operational policies.
const CONFIG_READ_ROLES = ["tenant_admin", "super_admin", "security_admin"];

export async function configRegistryRoutes(app: FastifyInstance): Promise<void> {
  // Set (create or version-guarded update) a config entry.
  app.post("/v1/visitor/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_WRITE_ROLES);
    const body = setConfigBody.parse(req.body);
    // Fast-fail optimistic-lock check (GAP-VISITOR-ADMIN-02): the write itself is
    // asynchronous (202 + consumer), so a stale expectedVersion would otherwise
    // only surface as a dead-lettered VERSION_CONFLICT. Surface it as a
    // synchronous 409 when we can already see the mismatch. This is a best-effort
    // pre-check (a concurrent write between here and the consumer is still
    // caught, authoritatively, by the consumer's version guard).
    if (body.expectedVersion !== undefined) {
      const current = await repo.getConfig(ctx.tenantId, body.namespace, body.configKey);
      if (current && current.version !== body.expectedVersion) {
        throw new HttpError(
          409, "VERSION_CONFLICT",
          `config ${body.namespace}/${body.configKey} expected v${body.expectedVersion}, found v${current.version}`,
        );
      }
    }
    const result = await commands.setConfig(ctx, body);
    return reply.code(202).send(result);
  });

  // List a namespace's entries. `?active=true` filters to active-only.
  app.get("/v1/visitor/config/:namespace", async (req, reply) => {
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
  app.get("/v1/visitor/config-entry", async (req, reply) => {
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
  // (secretariat | district-office | hospital) in one call. Idempotent per entry.
  app.post("/v1/visitor/config/presets/:preset", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_WRITE_ROLES);
    const preset = (req.params as { preset: string }).preset;
    const { reason } = applyPresetBody.parse(req.body ?? {});
    const result = await presets.applyPreset(ctx, preset, reason);
    return reply.code(202).send(result);
  });

  // Preview a preset's values so the admin UI can show a from -> to diff
  // against the current tenant policy BEFORE confirming (GAP-VISITOR-ADMIN-01).
  app.get("/v1/visitor/config/presets/:preset", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_WRITE_ROLES);
    const preset = (req.params as { preset: string }).preset;
    const entries = presets.getPreset(preset);
    if (!entries) {
      throw new HttpError(400, "UNKNOWN_PRESET", `no vertical preset '${preset}' (known: ${presets.PRESET_NAMES.join(", ")})`);
    }
    return reply.send({ preset, entries });
  });

  // Deactivate (soft-retire) a config entry by id.
  app.patch("/v1/visitor/config/:id/deactivate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_WRITE_ROLES);
    const { id } = configIdParam.parse(req.params);
    const body = deactivateConfigBody.parse(req.body);
    const result = await commands.deactivateConfig(ctx, id, body);
    return reply.code(202).send(result);
  });
}
