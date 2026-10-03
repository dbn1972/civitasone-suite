/**
 * platform-integrations — HTTP routes (eSign / DSC / bank API / PFMS).
 *
 *  PLATFORM CATALOGUE (super_admin / platform_admin)
 *    GET   /v1/admin/platform-integrations/providers
 *    GET   /v1/admin/platform-integrations/providers/:key
 *    PATCH /v1/admin/platform-integrations/providers/:key      status / availability / endpoints
 *
 *  TENANT CONFIG (tenant_admin + finance_admin/payroll_admin + platform roles)
 *    GET    /v1/admin/platform-integrations/tenant/catalogue
 *    GET    /v1/admin/platform-integrations/tenant/records
 *    GET    /v1/admin/platform-integrations/tenant/records/:key
 *    PUT    /v1/admin/platform-integrations/tenant/records/:key   (write-only secrets)
 *    DELETE /v1/admin/platform-integrations/tenant/records/:key
 *    POST   /v1/admin/platform-integrations/tenant/records/:key/test
 *    POST   /v1/admin/platform-integrations/tenant/records/:key/production-switch
 *    POST   /v1/admin/platform-integrations/tenant/records/:key/revert-sandbox
 *    GET    /v1/admin/platform-integrations/tenant/production-switches
 *    POST   /v1/admin/platform-integrations/tenant/production-switches/:id/{approve|reject|cancel}
 *    GET|PUT /v1/admin/platform-integrations/tenant/settings
 *
 * Every mutation: zod at the boundary -> synchronous pre-accept checks (fast
 * 4xx for the cases the consumer would also refuse) -> publish a command ->
 * 202. NO route writes the database; the consumer (consumer.ts) does the write
 * and the audit event in one transaction. Secrets are sealed HERE, before the
 * command is published, so plaintext never reaches the queue; no response ever
 * contains a secret, only `set: true|false` and a fixed mask.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { idempotentId } from "@civitasone/auth";
import { createAdapter, hasRealAdapter, type AdapterContext } from "@civitasone/connector-framework/ports";
import { resolveContext, requireRole, requireSuperAdmin, HttpError } from "../../shared/context.js";
import { publishAdminCommand } from "../../shared/f3-publish.js";
import { SecretDecryptError, SecretKeyUnavailableError, openSecret, sealSecret } from "../../shared/secret-crypto.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  IntegrationError,
  assertDeciderDistinct,
  assertProductionEligible,
  assertVersion,
  inactiveSecretKeys,
  isAvailableToTenant,
  maskedSecrets,
  missingRequired,
  parseFields,
  touchesSensitive,
  validateRecordInput,
} from "./domain.js";
import { providerPatchSchema } from "./commands.js";
import { INTEGRATION_CATEGORIES, PROVIDER_STATUSES } from "./schema.js";
import { INTEGRATION_ROLES, POLICY_ROLES, canUseCategory } from "./roles.js";
export { INTEGRATION_ROLES };
import type { IntegrationCategory, PolicyRequestRow, ProviderRow, SwitchRequestRow, TenantIntegrationRow } from "./schema.js";


const BASE = "/v1/admin/platform-integrations";
const keyParam = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function parseKey(params: unknown): string {
  const r = keyParam.safeParse((params as { key?: string }).key);
  if (!r.success) throw new HttpError(404, "UNKNOWN_PROVIDER", "unknown provider");
  return r.data;
}

// ── serializers (secrets are NEVER included) ─────────────────────────────────

function serializeProviderForPlatform(p: ProviderRow, usage?: { sandbox: number; production: number }) {
  return {
    key: p.key,
    category: p.category,
    name: p.name,
    vendor: p.vendor,
    description: p.description,
    capabilities: p.capabilities,
    fields: parseFields(p.configSchema),
    endpoints: p.endpoints,
    status: p.status,
    availability: { mode: p.availabilityMode, tenantIds: p.allowedTenantIds, editions: p.allowedEditions },
    usage: usage ?? { sandbox: 0, production: 0 },
    version: p.version,
    updatedAt: iso(p.updatedAt),
  };
}

/** Tenant-facing view: never exposes which other tenants are allow-listed. */
function serializeProviderForTenant(p: ProviderRow) {
  return {
    key: p.key,
    category: p.category,
    name: p.name,
    vendor: p.vendor,
    description: p.description,
    capabilities: p.capabilities,
    fields: parseFields(p.configSchema),
    endpoints: p.endpoints,
    status: p.status,
  };
}

function serializeRecord(row: TenantIntegrationRow, provider: ProviderRow | undefined) {
  const fields = provider ? parseFields(provider.configSchema) : [];
  const secretKeys = Object.keys(row.secrets ?? {});
  return {
    id: row.id,
    providerKey: row.providerKey,
    category: row.category,
    providerName: provider?.name ?? row.providerKey,
    providerStatus: provider?.status ?? "disabled",
    environment: row.environment,
    enabled: row.enabled,
    config: row.config,
    secrets: maskedSecrets(fields, row.secrets ?? {}),
    missingRequired: {
      sandbox: missingRequired(fields, "sandbox", row.config ?? {}, secretKeys),
      production: missingRequired(fields, "production", row.config ?? {}, secretKeys),
    },
    health: {
      status: row.lastTestStatus ?? "untested",
      code: row.lastTestCode,
      message: row.lastTestMessage,
      testedAt: iso(row.lastTestAt),
      environment: row.lastTestEnvironment,
    },
    version: row.version,
    updatedAt: iso(row.updatedAt),
    updatedBy: row.updatedBy,
  };
}

function serializeSwitch(r: SwitchRequestRow) {
  return {
    id: r.id,
    providerKey: r.providerKey,
    status: r.status,
    reason: r.reason,
    requestedBy: r.requestedBy,
    requestedAt: iso(r.requestedAt),
    decidedBy: r.decidedBy,
    decidedAt: iso(r.decidedAt),
    decisionNote: r.decisionNote,
    direct: r.direct,
  };
}

/** Category-scoped access: finance/payroll admins reach bank_api + pfms only. */
function requireCategory(roles: string[], category: IntegrationCategory): void {
  if (!canUseCategory(category, roles)) {
    throw new HttpError(403, "FORBIDDEN", "your role cannot manage this type of integration");
  }
}

function serializePolicy(r: PolicyRequestRow) {
  return {
    id: r.id, status: r.status, reason: r.reason, requestedBy: r.requestedBy, requestedAt: iso(r.requestedAt),
    decidedBy: r.decidedBy, decidedAt: iso(r.decidedAt), decisionNote: r.decisionNote,
  };
}

/** Provider must exist, be usable by this tenant, and not be disabled. */
async function loadUsableProvider(tenantId: string, key: string, roles: string[]): Promise<ProviderRow> {
  const provider = await repo.findProvider(key);
  if (!provider) throw new HttpError(404, "UNKNOWN_PROVIDER", "unknown provider");
  requireCategory(roles, provider.category);
  if (provider.status === "disabled") throw new IntegrationError(409, "PROVIDER_DISABLED", "this provider has been disabled by the platform");
  const edition = await repo.tenantEdition(tenantId);
  if (!isAvailableToTenant(provider, tenantId, edition)) {
    throw new IntegrationError(403, "PROVIDER_NOT_AVAILABLE", "this provider is not available to your organisation");
  }
  return provider;
}

const putBody = z.object({
  config: z.record(z.unknown()).default({}),
  secrets: z.record(z.string().max(8192)).default({}),
  clearSecrets: z.array(z.string().max(64)).max(50).default([]),
  enabled: z.boolean().default(true),
  expectedVersion: z.coerce.number().int().min(1).optional(),
});
const reasonBody = z.object({ reason: z.string().trim().min(5).max(1000) });
const decideBody = z.object({ note: z.string().trim().max(1000).optional() });
const patchBody = z.object({ expectedVersion: z.coerce.number().int().min(1) }).and(providerPatchSchema);
const settingsBody = z.object({
  requireProductionApproval: z.boolean(),
  reason: z.string().trim().min(5).max(1000).optional(),
  expectedVersion: z.coerce.number().int().min(1).optional(),
});
const listSwitchQuery = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
  providerKey: keyParam.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const listProvidersQuery = z.object({
  category: z.enum(INTEGRATION_CATEGORIES).optional(),
  status: z.enum(PROVIDER_STATUSES).optional(),
});
const deleteQuery = z.object({ expectedVersion: z.coerce.number().int().min(1) });

export async function platformIntegrationRoutes(app: FastifyInstance): Promise<void> {
  // ══ PLATFORM CATALOGUE ═════════════════════════════════════════════════════

  app.get(`${BASE}/providers`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const q = listProvidersQuery.parse(req.query ?? {});
    const [rows, usage] = await Promise.all([repo.listProviders(), repo.providerUsage()]);
    const data = rows
      .filter((p) => (q.category ? p.category === q.category : true) && (q.status ? p.status === q.status : true))
      .map((p) => serializeProviderForPlatform(p, usage.get(p.key)));
    return reply.send({ data });
  });

  app.get(`${BASE}/providers/:key`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const key = parseKey(req.params);
    const [provider, usage] = await Promise.all([repo.findProvider(key), repo.providerUsage()]);
    if (!provider) throw new HttpError(404, "UNKNOWN_PROVIDER", "unknown provider");
    return reply.send({ data: serializeProviderForPlatform(provider, usage.get(key)) });
  });

  app.patch(`${BASE}/providers/:key`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const key = parseKey(req.params);
    const body = patchBody.parse(req.body ?? {});
    const provider = await repo.findProvider(key);
    if (!provider) throw new HttpError(404, "UNKNOWN_PROVIDER", "unknown provider");
    assertVersion(body.expectedVersion, provider.version);
    if (body.availability?.mode === "restricted" && body.availability.tenantIds.length === 0 && body.availability.editions.length === 0) {
      throw new IntegrationError(400, "VALIDATION_FAILED", "a restricted provider needs at least one tenant or edition", [
        { field: "availability", message: "select at least one tenant or edition, or choose 'all tenants'" },
      ]);
    }
    const { expectedVersion, ...patch } = body;
    const id = idempotentId(ctx);
    await publishAdminCommand(ctx, COMMANDS.platformIntegrationProviderUpdate, id, { key, expectedVersion, patch });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId, data: { id } });
  });

  // ══ TENANT CONFIG ══════════════════════════════════════════════════════════

  app.get(`${BASE}/tenant/catalogue`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTEGRATION_ROLES);
    const [rows, edition, mine] = await Promise.all([repo.listProviders(), repo.tenantEdition(ctx.tenantId), repo.listIntegrations(ctx.tenantId)]);
    const configured = new Set(mine.map((r) => r.providerKey));
    const data = rows
      .filter((p) => canUseCategory(p.category, ctx.roles) && isAvailableToTenant(p, ctx.tenantId, edition))
      .map((p) => ({ ...serializeProviderForTenant(p), configured: configured.has(p.key) }));
    return reply.send({ data });
  });

  app.get(`${BASE}/tenant/records`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTEGRATION_ROLES);
    const [rows, providersAll, pending] = await Promise.all([
      repo.listIntegrations(ctx.tenantId),
      repo.listProviders(),
      repo.listSwitchRequests(ctx.tenantId, { status: "pending", limit: 100 }),
    ]);
    const byKey = new Map(providersAll.map((p) => [p.key, p]));
    const pendingByKey = new Map(pending.map((r) => [r.providerKey, r]));
    const data = rows.filter((r) => canUseCategory(r.category, ctx.roles)).map((r) => ({
      ...serializeRecord(r, byKey.get(r.providerKey)),
      pendingSwitch: pendingByKey.has(r.providerKey) ? serializeSwitch(pendingByKey.get(r.providerKey) as SwitchRequestRow) : null,
    }));
    return reply.send({ data });
  });

  app.get(`${BASE}/tenant/records/:key`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTEGRATION_ROLES);
    const key = parseKey(req.params);
    const [row, provider, history, settings] = await Promise.all([
      repo.findIntegration(ctx.tenantId, key),
      repo.findProvider(key),
      repo.listSwitchRequests(ctx.tenantId, { providerKey: key, limit: 20 }),
      repo.getSettings(ctx.tenantId),
    ]);
    if (!row) throw new HttpError(404, "NOT_CONFIGURED", "this integration is not configured");
    requireCategory(ctx.roles, row.category);
    return reply.send({
      data: serializeRecord(row, provider),
      pendingSwitch: history.find((h) => h.status === "pending") ? serializeSwitch(history.find((h) => h.status === "pending") as SwitchRequestRow) : null,
      switchHistory: history.map(serializeSwitch),
      approvalRequired: repo.approvalRequired(settings),
    });
  });

  app.put(`${BASE}/tenant/records/:key`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTEGRATION_ROLES);
    const key = parseKey(req.params);
    const body = putBody.parse(req.body ?? {});
    const provider = await loadUsableProvider(ctx.tenantId, key, ctx.roles);
    const fields = parseFields(provider.configSchema);
    const existing = await repo.findIntegration(ctx.tenantId, key);

    if (existing) {
      if (body.expectedVersion === undefined) {
        throw new IntegrationError(400, "VALIDATION_FAILED", "expectedVersion is required when updating", [{ field: "expectedVersion", message: "is required when updating an existing integration" }]);
      }
      assertVersion(body.expectedVersion, existing.version);
    } else if (body.expectedVersion !== undefined) {
      throw new HttpError(404, "NOT_CONFIGURED", "this integration is not configured yet; omit expectedVersion to create it");
    }

    const secretFieldKeys = new Set(fields.filter((f) => f.secret).map((f) => f.key));
    const badClear = body.clearSecrets.filter((k) => !secretFieldKeys.has(k));
    if (badClear.length > 0) {
      throw new IntegrationError(400, "VALIDATION_FAILED", "invalid integration configuration", badClear.map((k) => ({ field: k, message: "is not a secret field" })));
    }
    const validated = validateRecordInput(fields, { config: body.config, secrets: body.secrets });
    const conflicting = body.clearSecrets.filter((k) => k in validated.secrets);
    if (conflicting.length > 0) {
      throw new IntegrationError(400, "VALIDATION_FAILED", "invalid integration configuration", conflicting.map((k) => ({ field: k, message: "cannot be set and cleared in the same request" })));
    }

    // Seal BEFORE publishing: the queue, outbox and DLQ only ever see ciphertext.
    const sealedPatch: Record<string, string> = {};
    for (const [k, v] of Object.entries(validated.secrets)) sealedPatch[k] = sealSecret(v);
    const storedKeys = Object.keys(existing?.secrets ?? {});
    const clearSecrets = [...new Set([...body.clearSecrets, ...inactiveSecretKeys(fields, validated.config, storedKeys)])];

    const id = existing?.id ?? idempotentId(ctx);
    const revertsToSandbox = existing?.environment === "production"
      && touchesSensitive(fields, existing.config ?? {}, validated.config, Object.keys(sealedPatch), clearSecrets);
    await publishAdminCommand(ctx, COMMANDS.tenantIntegrationSave, id, {
      actorRoles: ctx.roles,
      providerKey: key,
      category: provider.category,
      newId: id,
      expectedVersion: existing ? existing.version : null,
      enabled: body.enabled,
      config: validated.config,
      sealedPatch,
      clearSecrets,
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId, data: { id }, revertsToSandbox });
  });

  app.delete(`${BASE}/tenant/records/:key`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTEGRATION_ROLES);
    const key = parseKey(req.params);
    const q = deleteQuery.parse(req.query ?? {});
    const existing = await repo.findIntegration(ctx.tenantId, key);
    if (!existing) throw new HttpError(404, "NOT_CONFIGURED", "this integration is not configured");
    requireCategory(ctx.roles, existing.category);
    assertVersion(q.expectedVersion, existing.version);
    const id = idempotentId(ctx);
    await publishAdminCommand(ctx, COMMANDS.tenantIntegrationDelete, id, { actorRoles: ctx.roles, providerKey: key, expectedVersion: q.expectedVersion });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId, data: { id } });
  });

  // ── test connection ────────────────────────────────────────────────────────
  app.post(`${BASE}/tenant/records/:key/test`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTEGRATION_ROLES);
    const key = parseKey(req.params);
    const provider = await loadUsableProvider(ctx.tenantId, key, ctx.roles);
    const row = await repo.findIntegration(ctx.tenantId, key);
    if (!row) throw new HttpError(404, "NOT_CONFIGURED", "this integration is not configured");

    // Production has no real adapter yet: say so plainly instead of faking a result.
    if (row.environment === "production" && !hasRealAdapter(key)) {
      return reply.code(501).send({
        code: "NOT_YET_AVAILABLE",
        message: "Not yet available — configured for UAT",
        correlationId: ctx.correlationId,
        retryable: false,
      });
    }

    const fields = parseFields(provider.configSchema);
    const missing = missingRequired(fields, row.environment, row.config ?? {}, Object.keys(row.secrets ?? {}));
    let result: { ok: boolean; code: string; message: string; latencyMs: number; mock: boolean };
    if (missing.length > 0) {
      result = { ok: false, code: "CONFIG_INCOMPLETE", message: `Required fields are missing: ${missing.join(", ")}`, latencyMs: 0, mock: row.environment === "sandbox" };
    } else {
      const secrets: Record<string, string> = {};
      for (const [k, v] of Object.entries(row.secrets ?? {})) secrets[k] = openSecret(v);
      const adapterCtx: AdapterContext = {
        providerKey: key,
        providerName: provider.name,
        environment: row.environment,
        config: row.config ?? {},
        secrets,
        endpointUrl: provider.endpoints[row.environment] ?? undefined,
      };
      result = await createAdapter(provider.category, adapterCtx).testConnection();
    }

    const id = idempotentId(ctx);
    await publishAdminCommand(ctx, COMMANDS.tenantIntegrationRecordTest, id, {
      actorRoles: ctx.roles,
      providerKey: key,
      environment: row.environment,
      status: result.ok ? "success" : "failure",
      code: result.code,
      message: result.message,
    });
    return reply.send({ data: { ok: result.ok, code: result.code, message: result.message, latencyMs: result.latencyMs, mock: result.mock, environment: row.environment } });
  });

  // ── production switch ──────────────────────────────────────────────────────
  app.post(`${BASE}/tenant/records/:key/production-switch`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTEGRATION_ROLES);
    const key = parseKey(req.params);
    const body = reasonBody.parse(req.body ?? {});
    const provider = await loadUsableProvider(ctx.tenantId, key, ctx.roles);
    const [row, settings, pending] = await Promise.all([
      repo.findIntegration(ctx.tenantId, key),
      repo.getSettings(ctx.tenantId),
      repo.listSwitchRequests(ctx.tenantId, { status: "pending", providerKey: key, limit: 1 }),
    ]);
    if (!row) throw new HttpError(404, "NOT_CONFIGURED", "this integration is not configured");
    if (row.environment === "production") throw new IntegrationError(409, "ALREADY_PRODUCTION", "this integration is already in production");
    assertProductionEligible(provider.status);
    const missing = missingRequired(parseFields(provider.configSchema), "production", row.config ?? {}, Object.keys(row.secrets ?? {}));
    if (missing.length > 0) {
      throw new IntegrationError(409, "CONFIG_INCOMPLETE", "complete the required fields before switching to production",
        missing.map((m) => ({ field: m, message: "is required for production" })));
    }
    if (pending.length > 0) throw new IntegrationError(409, "ALREADY_PENDING", "a production switch is already awaiting approval");

    const id = idempotentId(ctx);
    await publishAdminCommand(ctx, COMMANDS.tenantIntegrationSwitchRequest, id, {
      actorRoles: ctx.roles,
      requestId: id, providerKey: key, reason: body.reason, baseVersion: row.version,
    });
    return reply.code(202).send({
      id, status: "accepted", correlationId: ctx.correlationId, data: { id },
      mode: repo.approvalRequired(settings) ? "pending_approval" : "direct",
    });
  });

  app.post(`${BASE}/tenant/records/:key/revert-sandbox`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTEGRATION_ROLES);
    const key = parseKey(req.params);
    const body = reasonBody.extend({ expectedVersion: z.coerce.number().int().min(1) }).parse(req.body ?? {});
    const row = await repo.findIntegration(ctx.tenantId, key);
    if (!row) throw new HttpError(404, "NOT_CONFIGURED", "this integration is not configured");
    requireCategory(ctx.roles, row.category);
    if (row.environment !== "production") throw new IntegrationError(409, "NOT_PRODUCTION", "this integration is not in production");
    assertVersion(body.expectedVersion, row.version);
    const id = idempotentId(ctx);
    await publishAdminCommand(ctx, COMMANDS.tenantIntegrationRevertSandbox, id, { actorRoles: ctx.roles, providerKey: key, expectedVersion: body.expectedVersion, reason: body.reason });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId, data: { id } });
  });

  app.get(`${BASE}/tenant/production-switches`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTEGRATION_ROLES);
    const q = listSwitchQuery.parse(req.query ?? {});
    const [rows, allProviders] = await Promise.all([repo.listSwitchRequests(ctx.tenantId, q), repo.listProviders()]);
    const cat = new Map(allProviders.map((p) => [p.key, p.category]));
    const visible = rows.filter((r) => { const c = cat.get(r.providerKey); return c !== undefined && canUseCategory(c, ctx.roles); });
    return reply.send({ data: visible.map(serializeSwitch) });
  });

  for (const decision of ["approve", "reject", "cancel"] as const) {
    app.post(`${BASE}/tenant/production-switches/:id/${decision}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, INTEGRATION_ROLES);
      const requestId = z.string().uuid().parse((req.params as { id?: string }).id);
      const body = decideBody.parse(req.body ?? {});
      const request = await repo.findSwitchRequest(ctx.tenantId, requestId);
      if (!request) throw new HttpError(404, "NOT_FOUND", "production switch request not found");
      const requestProvider = await repo.findProvider(request.providerKey);
      if (!requestProvider) throw new HttpError(404, "NOT_FOUND", "production switch request not found");
      requireCategory(ctx.roles, requestProvider.category);
      if (request.status !== "pending") throw new IntegrationError(409, "NOT_PENDING", `request is '${request.status}', only pending requests can be decided`);
      if (decision === "cancel") {
        if (request.requestedBy !== ctx.actorId) throw new IntegrationError(403, "FORBIDDEN", "only the requester can cancel a production switch");
      } else {
        assertDeciderDistinct(request.requestedBy, ctx.actorId);
      }
      if (decision === "approve") {
        const [row, provider] = await Promise.all([repo.findIntegration(ctx.tenantId, request.providerKey), repo.findProvider(request.providerKey)]);
        if (!row || !provider) throw new HttpError(404, "NOT_CONFIGURED", "this integration is no longer configured");
        assertProductionEligible(provider.status);
        if (row.version !== request.baseVersion) {
          throw new IntegrationError(409, "STALE_CONFIGURATION", "the configuration changed after this request was raised; ask for a fresh request");
        }
      }
      const id = idempotentId(ctx);
      await publishAdminCommand(ctx, COMMANDS.tenantIntegrationSwitchDecide, id, { actorRoles: ctx.roles, requestId, decision, note: body.note ?? null });
      return reply.code(202).send({ id: requestId, status: "accepted", correlationId: ctx.correlationId, data: { id: requestId } });
    });
  }

  app.get(`${BASE}/tenant/settings`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTEGRATION_ROLES);
    const [row, pending] = await Promise.all([repo.getSettings(ctx.tenantId), repo.listPolicyRequests(ctx.tenantId, "pending", 1)]);
    return reply.send({
      data: {
        requireProductionApproval: repo.approvalRequired(row), version: row?.version ?? null, isDefault: !row,
        pendingPolicyChange: pending[0] ? serializePolicy(pending[0]) : null,
      },
    });
  });

  // Turning approval ON is single-actor (it only tightens control). Turning it OFF files a
  // policy-change request that a DIFFERENT administrator must approve.
  app.put(`${BASE}/tenant/settings`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, POLICY_ROLES as string[]);
    const body = settingsBody.parse(req.body ?? {});
    const row = await repo.getSettings(ctx.tenantId);
    const currentlyOn = repo.approvalRequired(row);
    const id = idempotentId(ctx);
    if (!body.requireProductionApproval) {
      if (!currentlyOn) throw new IntegrationError(409, "ALREADY_OFF", "production approval is already switched off");
      if (!body.reason) {
        throw new IntegrationError(400, "VALIDATION_FAILED", "a reason is required to switch approval off", [{ field: "reason", message: "explain why approval should be switched off" }]);
      }
      const pending = await repo.listPolicyRequests(ctx.tenantId, "pending", 1);
      if (pending.length > 0) throw new IntegrationError(409, "ALREADY_PENDING", "a request to switch approval off is already awaiting approval");
      await publishAdminCommand(ctx, COMMANDS.tenantIntegrationPolicyRequest, id, { actorRoles: ctx.roles, requestId: id, reason: body.reason });
      return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId, data: { id }, mode: "pending_approval" });
    }
    if (currentlyOn) throw new IntegrationError(409, "ALREADY_ON", "production approval is already required");
    if (row) {
      if (body.expectedVersion === undefined) {
        throw new IntegrationError(400, "VALIDATION_FAILED", "expectedVersion is required when updating", [{ field: "expectedVersion", message: "is required when updating" }]);
      }
      assertVersion(body.expectedVersion, row.version);
    }
    await publishAdminCommand(ctx, COMMANDS.tenantIntegrationSettingsUpdate, id, { actorRoles: ctx.roles, requireProductionApproval: true, expectedVersion: row ? row.version : null });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId, data: { id }, mode: "applied" });
  });

  app.get(`${BASE}/tenant/policy-changes`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTEGRATION_ROLES);
    const q = listSwitchQuery.pick({ status: true, limit: true }).parse(req.query ?? {});
    return reply.send({ data: (await repo.listPolicyRequests(ctx.tenantId, q.status, q.limit)).map(serializePolicy) });
  });

  for (const decision of ["approve", "reject", "cancel"] as const) {
    app.post(`${BASE}/tenant/policy-changes/:id/${decision}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, POLICY_ROLES);
      const requestId = z.string().uuid().parse((req.params as { id?: string }).id);
      const body = decideBody.parse(req.body ?? {});
      const request = await repo.findPolicyRequest(ctx.tenantId, requestId);
      if (!request) throw new HttpError(404, "NOT_FOUND", "policy change request not found");
      if (request.status !== "pending") throw new IntegrationError(409, "NOT_PENDING", `request is '${request.status}', only pending requests can be decided`);
      if (decision === "cancel") {
        if (request.requestedBy !== ctx.actorId) throw new IntegrationError(403, "FORBIDDEN", "only the requester can cancel this request");
      } else {
        assertDeciderDistinct(request.requestedBy, ctx.actorId);
      }
      const id = idempotentId(ctx);
      await publishAdminCommand(ctx, COMMANDS.tenantIntegrationPolicyDecide, id, { actorRoles: ctx.roles, requestId, decision, note: body.note ?? null });
      return reply.code(202).send({ id: requestId, status: "accepted", correlationId: ctx.correlationId, data: { id: requestId } });
    });
  }

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof IntegrationError) {
      return reply.code(err.status).send({
        code: err.code, message: err.message, correlationId, retryable: false,
        ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    if (err instanceof SecretKeyUnavailableError) {
      return reply.code(503).send({ code: err.code, message: "Secret storage is not configured. Contact your platform administrator.", correlationId, retryable: false });
    }
    if (err instanceof SecretDecryptError) {
      return reply.code(503).send({ code: err.code, message: "A stored secret could not be read. Re-enter the credentials.", correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
