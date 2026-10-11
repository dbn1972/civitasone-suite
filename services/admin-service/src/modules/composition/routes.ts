/**
 * Module Composition & Org-Profile onboarding — HTTP routes (Fastify plugin).
 *
 *   GET  /v1/admin/composition/registry              — global module catalogue + profiles
 *   GET  /v1/admin/composition/tenant                — effective composition for caller's tenant
 *   POST /v1/admin/composition/onboard {profile}     — apply an org profile (Govt/PSU/Section-8)
 *   POST /v1/admin/composition/modules/:id/enable    — enable a module (auto-pulls hard deps)
 *   POST /v1/admin/composition/modules/:id/disable   — disable a module (409 if depended on)
 *
 * The persisted source-of-truth is the tenant's USER selections; core + deps are
 * derived by the pure resolver in domain.ts. Writes are transactional + RLS-scoped.
 */
import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { toGatewayKeys } from "./gateway-map.js";
import {
  buildRegistry,
  resolveComposition,
  applyEnable,
  applyDisable,
  canDisable,
  CompositionError,
  type Registry,
} from "./domain.js";

const ADMIN_ROLES = ["tenant_admin", "super_admin", "platform_admin"];
const PLATFORM_ADMIN = ["super_admin", "platform_admin"];

const onboardBody = z.object({ profile: z.string().min(1).max(64) });
const internalParam = z.object({ tenantId: z.string().uuid() });
const moduleParam = z.object({ id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/) });
const bundleParam = z.object({ code: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/) });
const enforcementModeBody = z.object({ mode: z.enum(["off", "shadow", "enforce"]) });
const enforcementModeParam = z.object({ tenantId: z.string().uuid() });
// ST-M01-03 — plan-to-composition applier. `tenantId` is OPTIONAL and only
// honoured for platform/super admins (a tenant_admin may only apply to its own
// tenant — never trust a client-supplied tenant id for a tenant-scoped actor).
const applyPlanBody = z.object({
  moduleIds: z.array(z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/)).max(128),
  profileCode: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/).nullable().default(null),
  tenantId: z.string().uuid().optional(),
});

function safeParse<T>(schema: z.ZodType<T, z.ZodTypeDef, any>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new HttpError(400, "VALIDATION_FAILED", msg);
  }
  return result.data;
}

/** Load the registry and build the pure in-memory graph for a tenant. */
async function registryFor(tenantId: string): Promise<Registry> {
  const mods = await repo.loadRegistry(tenantId);
  if (mods.length === 0) {
    throw new HttpError(503, "REGISTRY_EMPTY", "module registry not seeded (run migration 0025)");
  }
  return buildRegistry(mods);
}

/** Compose the full tenant-facing view: profile packs + resolved modules + screens. */
async function tenantView(tenantId: string): Promise<unknown> {
  const [reg, profiles, profileCode, userModules] = await Promise.all([
    registryFor(tenantId),
    repo.loadProfiles(tenantId),
    repo.getTenantProfileCode(tenantId),
    repo.getUserModules(tenantId),
  ]);
  const comp = resolveComposition(reg, userModules);
  const profile = profileCode ? profiles.find((p) => p.code === profileCode) ?? null : null;

  const modules = comp.entries.map((e) => {
    const m = reg.get(e.id)!;
    return { id: m.id, name: m.name, layer: m.layer, cluster: m.cluster, source: e.source, screens: m.screens };
  });
  const counts = {
    total: comp.entries.length,
    core: comp.entries.filter((e) => e.source === "core").length,
    user: comp.entries.filter((e) => e.source === "user").length,
    dep: comp.entries.filter((e) => e.source === "dep").length,
    screens: comp.screens.length,
  };
  return {
    tenantId,
    profile: profile
      ? {
          code: profile.code,
          label: profile.label,
          rulePacks: profile.rulePacks,
          terminology: profile.terminology,
          statutory: profile.statutory,
          reservation: profile.reservation,
        }
      : null,
    modules,
    screens: comp.screens,
    counts,
  };
}

export async function compositionRoutes(app: FastifyInstance): Promise<void> {
  // GLOBAL catalogue: module registry (with deps) + org-profile options.
  app.get("/v1/admin/composition/registry", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const [mods, profiles, bundles] = await Promise.all([
      repo.loadRegistry(ctx.tenantId),
      repo.loadProfiles(ctx.tenantId),
      repo.loadBundles(ctx.tenantId),
    ]);
    return reply.send({
      modules: mods.map((m) => ({
        id: m.id,
        name: m.name,
        layer: m.layer,
        isCore: m.isCore,
        cluster: m.cluster,
        hardDeps: m.hardDeps,
        softDeps: m.softDeps,
        screens: m.screens,
      })),
      bundles: bundles.map((b) => ({ code: b.code, label: b.label, subtitle: b.subtitle, moduleIds: b.moduleIds })),
      profiles: profiles.map((p) => ({
        code: p.code,
        label: p.label,
        subtitle: p.subtitle,
        rulePacks: p.rulePacks,
        terminology: p.terminology,
        statutory: p.statutory,
        reservation: p.reservation,
        defaultModules: p.defaultModules,
      })),
    });
  });

  // Effective composition for the caller's tenant.
  app.get("/v1/admin/composition/tenant", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    return reply.send(await tenantView(ctx.tenantId));
  });

  // INTERNAL (service-to-service) — resolved module entitlements for the gateway
  // module-guard, projected to the gateway's route-key vocabulary. Auth via
  // INTERNAL_SERVICE_SECRET (no user JWT), mirroring /tenants/:id/modules-list.
  //
  // `configured` is FALSE when the tenant has never onboarded (no profile, no
  // entitlements). The gateway MUST treat configured:false as "fail open"
  // (allow all) — never as an empty allow-list — so turning enforcement on can
  // never black-hole a tenant that predates composition onboarding.
  //
  // Defense-in-depth (follow-up to gateway-service#986): a valid shared secret
  // ALONE is not a reliable "this is a genuine machine caller" signal — the
  // secret can end up attached to ordinary client-forwarded traffic (as the
  // gateway's proxyHandler briefly did). We therefore also require the
  // explicit `x-internal: "1"` flag, mirroring the pattern already used
  // correctly by policy-service (`evaluate/routes.ts`) and crm-service
  // (`contacts/routes.ts`) — a proxy would never set this flag on an ordinary
  // forwarded client request. Secret-only or flag-only requests fall through
  // to the normal role-based auth path below, they are never auto-rejected.
  app.get("/v1/admin/composition/internal/:tenantId/modules", async (req, reply) => {
    const secret = req.headers["x-internal-secret"] as string | undefined;
    const hasInternalFlag = req.headers["x-internal"] === "1";
    const expected = process.env.INTERNAL_SERVICE_SECRET;
    // Fail-closed: an unconfigured INTERNAL_SERVICE_SECRET must NEVER be treated
    // as "trust everyone" — secretNotConfigured forces validInternal to false
    // below, so every request always falls through to normal role-based JWT
    // auth (mirrors the modules-list route; mirrors requireSecret()'s fail-closed
    // posture in ecosystem.config.js and assertInternalServiceSecret() in
    // @civitasone/auth/plugin — a missing secret must degrade to "reject the
    // shortcut", never "skip the check").
    const secretNotConfigured = typeof expected !== "string" || expected.length === 0;
    const validInternal =
      !secretNotConfigured &&
      hasInternalFlag &&
      typeof secret === "string" &&
      secret.length === expected.length &&
      timingSafeEqual(Buffer.from(secret, "utf8"), Buffer.from(expected, "utf8"));
    if (!validInternal) {
      const ctx = resolveContext(req);
      requireRole(ctx, ADMIN_ROLES);
    }
    const { tenantId } = safeParse(internalParam, req.params);
    const [profileCode, userModules, mode] = await Promise.all([
      repo.getTenantProfileCode(tenantId),
      repo.getUserModules(tenantId),
      repo.getEffectiveEnforcementMode(tenantId),
    ]);
    const configured = profileCode !== null || userModules.length > 0;
    if (!configured) return reply.send({ configured: false, mode, data: [] });
    const reg = await registryFor(tenantId);
    const comp = resolveComposition(reg, userModules);
    return reply.send({ configured: true, mode, data: toGatewayKeys(comp.moduleIds).map((name) => ({ name })) });
  });

  // The caller's OWN enabled modules (gateway route-keys) for web nav visibility.
  // Any authenticated user — the sidebar is shown to everyone and this only
  // reveals which modules exist for the caller's own tenant (RLS-scoped). An
  // empty list (un-onboarded tenant) makes the web treat visibility as "unknown"
  // and show all — fail-open, never a blank nav.
  app.get("/v1/admin/composition/my-modules", async (req, reply) => {
    const ctx = resolveContext(req);
    const [profileCode, userModules] = await Promise.all([
      repo.getTenantProfileCode(ctx.tenantId),
      repo.getUserModules(ctx.tenantId),
    ]);
    if (profileCode === null && userModules.length === 0) return reply.send({ data: [] });
    const reg = await registryFor(ctx.tenantId);
    const comp = resolveComposition(reg, userModules);
    return reply.send({ data: toGatewayKeys(comp.moduleIds).map((name) => ({ name })) });
  });

  // Onboard: apply an org profile (sets terminology/rule-packs + default modules).
  app.post("/v1/admin/composition/onboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { profile } = safeParse(onboardBody, req.body);
    const profiles = await repo.loadProfiles(ctx.tenantId);
    const chosen = profiles.find((p) => p.code === profile);
    if (!chosen) throw new HttpError(404, "UNKNOWN_PROFILE", `unknown org profile: ${profile}`);
    // Validate the profile's default modules against the registry before persisting.
    const reg = await registryFor(ctx.tenantId);
    for (const id of chosen.defaultModules) {
      if (!reg.has(id)) throw new HttpError(500, "PROFILE_INVALID", `profile ${profile} references unknown module ${id}`);
    }
    await repo.applyProfile(ctx.tenantId, chosen.code, chosen.defaultModules, ctx.actorId);
    return reply.send(await tenantView(ctx.tenantId));
  });

  // Read the EFFECTIVE module-gating enforcement mode for a tenant (FF-03,
  // D-ST-24). off | shadow | enforce, resolved per repo.getEffectiveEnforcementMode
  // (explicit row > standalone-profile ⇒ enforce > off). Platform-operator
  // control surface; scoped to platform/super admins only.
  app.get("/v1/admin/composition/:tenantId/enforcement-mode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["super_admin", "platform_admin"]);
    const { tenantId } = safeParse(enforcementModeParam, req.params);
    const mode = await repo.getEffectiveEnforcementMode(tenantId);
    return reply.send({ tenantId, mode });
  });

  // Set the EXPLICIT per-tenant enforcement mode. Default is `off` (fail-open,
  // the gateway-service #986 legacy safeguard); an operator moves a tenant to
  // `shadow` (log would-denies, still allow) then `enforce` (fail closed) after
  // the grandfather backfill (migration 0050) has run. Platform/super admin only.
  app.put("/v1/admin/composition/:tenantId/enforcement-mode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["super_admin", "platform_admin"]);
    const { tenantId } = safeParse(enforcementModeParam, req.params);
    const { mode } = safeParse(enforcementModeBody, req.body);
    await repo.setEnforcementMode(tenantId, mode, ctx.actorId);
    return reply.send({ tenantId, mode });
  });

  // Apply a subscription plan's module set (+ optional profile) to a tenant's
  // composition — the plan-to-composition applier (ST-M01-03). Write path:
  // validate → publish command → 202; the consumer does the durable write +
  // audit in one transaction. A tenant_admin may only apply to its OWN tenant;
  // a platform/super admin may target any tenant via `tenantId` in the body.
  app.post("/v1/admin/composition/apply-plan", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const result = applyPlanBody.safeParse(req.body);
    if (!result.success) {
      const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new HttpError(400, "VALIDATION_FAILED", msg);
    }
    const { moduleIds, profileCode, tenantId: bodyTenant } = result.data;
    // Server-derived tenant: only a platform/super admin may act on another
    // tenant; everyone else is pinned to their own context tenant.
    const isPlatform = PLATFORM_ADMIN.some((r) => ctx.roles?.includes(r));
    const targetTenant = isPlatform && bodyTenant ? bodyTenant : ctx.tenantId;

    // Pre-validate the module set + profile against the GLOBAL registry so a
    // bogus request is a 4xx here, not a silent DLQ later. (The consumer
    // re-validates and is the source of truth for the write.)
    const reg = await registryFor(targetTenant);
    for (const id of moduleIds) {
      if (!reg.has(id)) throw new HttpError(404, "UNKNOWN_MODULE", `unknown module: ${id}`);
    }
    if (profileCode !== null) {
      const profiles = await repo.loadProfiles(targetTenant);
      if (!profiles.some((p) => p.code === profileCode)) {
        throw new HttpError(404, "UNKNOWN_PROFILE", `unknown org profile: ${profileCode}`);
      }
    }

    const accepted = await commands.applyPlan(ctx, { tenantId: targetTenant, moduleIds, profileCode });
    return sendAccepted(reply, acceptedResponseSchema, accepted);
  });

  // Enable a module — hard deps are pulled in automatically.
  app.post("/v1/admin/composition/modules/:id/enable", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = safeParse(moduleParam, req.params);
    const reg = await registryFor(ctx.tenantId);
    if (!reg.has(id)) throw new HttpError(404, "UNKNOWN_MODULE", `unknown module: ${id}`);
    const nextUser = applyEnable(reg, await repo.getUserModules(ctx.tenantId), id);
    await repo.replaceUserModules(ctx.tenantId, nextUser, ctx.actorId);
    return reply.send(await tenantView(ctx.tenantId));
  });

  // Enable a whole bundle (cluster) — every module in it becomes a user pick,
  // and each module's hard deps are pulled in automatically.
  app.post("/v1/admin/composition/bundles/:code/enable", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { code } = safeParse(bundleParam, req.params);
    const bundles = await repo.loadBundles(ctx.tenantId);
    const bundle = bundles.find((b) => b.code === code);
    if (!bundle) throw new HttpError(404, "UNKNOWN_BUNDLE", `unknown bundle: ${code}`);
    const reg = await registryFor(ctx.tenantId);
    let nextUser = await repo.getUserModules(ctx.tenantId);
    for (const id of bundle.moduleIds) {
      if (!reg.has(id)) throw new HttpError(500, "BUNDLE_INVALID", `bundle ${code} references unknown module ${id}`);
      nextUser = applyEnable(reg, nextUser, id);
    }
    await repo.replaceUserModules(ctx.tenantId, nextUser, ctx.actorId);
    return reply.send(await tenantView(ctx.tenantId));
  });

  // Disable a module — blocked (409) if another enabled module hard-depends on it.
  app.post("/v1/admin/composition/modules/:id/disable", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = safeParse(moduleParam, req.params);
    const reg = await registryFor(ctx.tenantId);
    if (!reg.has(id)) throw new HttpError(404, "UNKNOWN_MODULE", `unknown module: ${id}`);
    const userModules = await repo.getUserModules(ctx.tenantId);
    const check = canDisable(reg, userModules, id);
    if (!check.ok) {
      const reason =
        check.blockers[0] === "__core__"
          ? "core modules cannot be disabled"
          : `required by: ${check.blockers.map((b) => reg.get(b)?.name ?? b).join(", ")}`;
      throw new HttpError(409, "COMPOSITION_BLOCKED", reason);
    }
    try {
      const nextUser = applyDisable(reg, userModules, id);
      await repo.replaceUserModules(ctx.tenantId, nextUser, ctx.actorId);
    } catch (err) {
      if (err instanceof CompositionError) throw new HttpError(409, err.code, err.message);
      throw err;
    }
    return reply.send(await tenantView(ctx.tenantId));
  });
}
