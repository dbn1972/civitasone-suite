/**
 * Settings module HTTP routes (Fastify plugin).
 * Writes return 202. Reads return 200 from cache.
 */
import type { FastifyInstance, RouteHandlerMethod } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { settingUpsertBody, settingDeleteBody, tenantIdParam, settingKeyParam } from "./validators.js";
import * as commands from "./commands.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

const ADMIN_ROLES = ["platform_admin", "super_admin", "tenant_admin"];
const RESOURCE = "setting";

// GAP-TENANT-SETTINGS-01: a configuration key whose name marks it as a
// credential must never leave the service in the LIST response (the registry
// view is for review, not for retrieving secrets). The per-key read stays
// admin-only and unmasked for the owner who maintains the value.
const SECRET_KEY_RE = /(?:secret|password|passwd|token|api[_-]?key|private[_-]?key|credential)/i;
export const MASKED_SETTING_VALUE = "********";

export function maskSecretSettings<T extends { key: string; value: unknown }>(rows: T[]): T[] {
  return rows.map((r) => (SECRET_KEY_RE.test(r.key) ? { ...r, value: MASKED_SETTING_VALUE } : r));
}

export async function settingRoutes(app: FastifyInstance): Promise<void> {
  // UPSERT setting
  app.put("/v1/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = settingUpsertBody.parse(req.body);
    const res = await commands.settingUpsert(ctx, body);
    return sendAccepted(reply, acceptedResponseSchema, res);
  });

  // DELETE setting
  app.delete("/v1/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = settingDeleteBody.parse(req.body);
    const res = await commands.settingDelete(ctx, body);
    return sendAccepted(reply, acceptedResponseSchema, res);
  });

  // LIST all settings for current tenant
  const listSettings: RouteHandlerMethod = async (req, reply) => {
    const ctx = resolveContext(req);
    // GAP-TENANT-HOME-01: tenant-scoped configuration is governance data; a
    // bare signed-in session is not enough to read the settings registry.
    requireRole(ctx, ADMIN_ROLES);
    if (!ctx.tenantId) throw new HttpError(401, "UNAUTHENTICATED", "no tenant in context");
    const settings = await repo.findAllByTenant(ctx.tenantId);
    return reply.send(maskSecretSettings(settings));
  };
  // GAP2-TENANT-WIRING-01: web settings loader calls /api/v1/tenant/settings
  // (gateway forwards verbatim). Alias so it resolves instead of 404.
  app.get("/v1/settings", listSettings);
  app.get("/v1/tenant/settings", listSettings);

  // GET specific setting by key (cache-first)
  app.get("/v1/settings/:key", async (req, reply) => {
    const ctx = resolveContext(req);
    // GAP-TENANT-SETTINGS-01: a single configuration key can hold a
    // credential/secret value. The list route (/v1/settings) is already
    // admin-gated; gate the per-key read with the same role set so a bare
    // signed-in employee cannot read an individual secret-typed key either.
    requireRole(ctx, ADMIN_ROLES);
    if (!ctx.tenantId) throw new HttpError(401, "UNAUTHENTICATED", "no tenant in context");
    const { key } = settingKeyParam.parse(req.params);
    const view = await cache.getOrLoad(
      cache.makeKey(ctx.tenantId, RESOURCE, key),
      async () => repo.findByTenantAndKey(ctx.tenantId, key),
    );
    if (!view) throw new HttpError(404, "NOT_FOUND", "setting not found");
    return reply.send(view);
  });

  // GET settings for a specific tenant (admin cross-tenant read)
  app.get("/v1/settings/tenant/:tenantId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["platform_admin", "super_admin"]);
    const { tenantId } = tenantIdParam.parse(req.params);
    const settings = await repo.findAllByTenant(tenantId);
    return reply.send(maskSecretSettings(settings));
  });
}
