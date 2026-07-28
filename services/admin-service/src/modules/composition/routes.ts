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
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
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

const onboardBody = z.object({ profile: z.string().min(1).max(64) });
const internalParam = z.object({ tenantId: z.string().uuid() });
const moduleParam = z.object({ id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/) });
const bundleParam = z.object({ code: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/) });

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
  app.get("/v1/admin/composition/internal/:tenantId/modules", async (req, reply) => {
    const secret = req.headers["x-internal-secret"] as string | undefined;
    const expected = process.env.INTERNAL_SERVICE_SECRET;
    const secretNotConfigured = typeof expected !== "string" || expected.length === 0;
    const validInternal =
      !secretNotConfigured &&
      typeof secret === "string" &&
      secret.length === expected.length &&
      timingSafeEqual(Buffer.from(secret, "utf8"), Buffer.from(expected, "utf8"));
    // If the secret IS configured but the caller didn't present a valid one,
    // fall back to super-admin JWT auth (mirrors the modules-list route).
    if (!validInternal && !secretNotConfigured) {
      const ctx = resolveContext(req);
      requireRole(ctx, ADMIN_ROLES);
    }
    const { tenantId } = safeParse(internalParam, req.params);
    const [profileCode, userModules] = await Promise.all([
      repo.getTenantProfileCode(tenantId),
      repo.getUserModules(tenantId),
    ]);
    const configured = profileCode !== null || userModules.length > 0;
    if (!configured) return reply.send({ configured: false, data: [] });
    const reg = await registryFor(tenantId);
    const comp = resolveComposition(reg, userModules);
    return reply.send({ configured: true, data: toGatewayKeys(comp.moduleIds).map((name) => ({ name })) });
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
