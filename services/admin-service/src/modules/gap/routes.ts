import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { eq, desc } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import {
  callUpstream, relayError, identityBaseUrl, auditBaseUrl, tenantServiceBaseUrl,
} from "./upstream-client.js";
// Real backing stores already registered elsewhere in this same service —
// COMP-001 fix: these routes used to fabricate their responses instead of
// reading the store their own sibling modules already write to.
import { exportRequests } from "../data-export/schema.js";
import { customDomains } from "../custom-domains/schema.js";
import { featureFlags } from "../feature-flags/schema.js";
import * as featureFlagCommands from "../feature-flags/commands.js";
import * as complianceRepo from "../security-compliance/repo.js";
import { computePosture } from "../security-compliance/posture.js";
import * as incidentRepo from "../security-incident/repo.js";

const ROLES = ["tenant_admin", "platform_admin", "super_admin"];
// Tighter gates matching the CANONICAL module for a resource, used only where
// that module's own role list is narrower than ROLES above — never looser:
// aliasing a route must never grant a caller a capability the real owning
// module wouldn't. See PR description for the per-route rationale.
const FEATURE_FLAG_ADMIN = ["platform_admin", "super_admin"];
const CUSTOM_DOMAIN_ADMIN = ["platform_admin", "super_admin"];

function toIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

function pageMeta(limit: number, offset: number, total: number) {
  return { page: Math.floor(offset / limit) + 1, pageSize: limit, total };
}

const NOT_IMPLEMENTED = (message: string) => ({ code: "NOT_IMPLEMENTED", message });

/**
 * Routes for screens that previously had no real backing (COMP-001).
 *
 * Every route below either (a) reads/writes a real store — either one of this
 * service's own sibling modules (compliance, data-export, custom-domains,
 * feature-flags, security-incident), or a peer service's real store reached
 * by forwarding the caller's own bearer token (identity-service RBAC/users,
 * audit-service events, tenant-service quotas, tenant-service org-hierarchy)
 * — or (b) honestly returns 501 where no real backing exists and building
 * one is out of scope for this single gap (see the PR body for the specific
 * reasoning per route: SSO/IdP provider federation has no real store because
 * identity-service's own SAML config endpoint is itself an unfinished TODO
 * stub, not something safe to build on; the combined security-overview
 * dashboard mixes real fields with one metric — failed-login count — that no
 * service in this platform tracks anywhere; role-metadata update has no
 * command in identity-service's RBAC domain at all).
 *
 * No route here returns 2xx with fabricated data.
 */
export async function adminGapRoutes(app: FastifyInstance): Promise<void> {
  // ─── Compliance — real, computed from admin-service's own persisted control library ───
  app.get("/v1/admin/compliance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const controls = await complianceRepo.listControls(ctx.tenantId);
    const posture = computePosture(controls as { framework: string; status: string }[]);
    const dpdpPosture = computePosture(
      (controls as { framework: string; status: string }[]).filter((c) => c.framework === "DPDP"),
    );
    const retentionControl = (controls as { controlKey: string; title: string; status: string }[]).find(
      (c) => /retention/i.test(c.controlKey) || /retention/i.test(c.title),
    );
    const retentionStatus = !retentionControl
      ? "Not configured"
      : retentionControl.status === "pass"
        ? "Compliant"
        : retentionControl.status === "fail"
          ? "Needs attention"
          : "Pending review";
    const checks = (controls as { id: string; updatedAt: unknown; title: string; status: string }[])
      .slice()
      .sort((a, b) => new Date(b.updatedAt as string).getTime() - new Date(a.updatedAt as string).getTime())
      .slice(0, 20)
      .map((c) => ({
        id: c.id,
        timestamp: toIso(c.updatedAt),
        title: c.title,
        result: c.status === "pass" ? "pass" : c.status === "fail" ? "fail" : "warn",
      }));
    // Flat shape (NOT wrapped in `{data: ...}`) — matches
    // apps/web/src/app/_data/loaders.ts's ComplianceOverview mapResponse,
    // which reads these fields off the top-level payload directly. The
    // fabricated route this replaces returned `{data:{score,checks}}`, a
    // shape the frontend loader never actually read (a second, independent
    // bug on top of the fabrication itself — fixed here too).
    return reply.send({
      dpdpScore: dpdpPosture.overallScore ?? 0,
      certInReadiness: posture.overallScore ?? 0,
      retentionStatus,
      checks,
    });
  });

  // ─── Data exports — real, same store as POST/GET /v1/admin/data-export (singular) ───
  app.get("/v1/admin/data-exports", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const rows = await scopedRead((tx) =>
      tx.select().from(exportRequests).where(eq(exportRequests.tenantId, ctx.tenantId)).orderBy(desc(exportRequests.createdAt)).limit(50),
    );
    return reply.send({ data: rows, meta: pageMeta(50, 0, rows.length) });
  });

  // ─── Custom domains — real, same store as /v1/admin/custom-domains ───
  // Tightened to CUSTOM_DOMAIN_ADMIN: the canonical custom-domains module
  // itself does not allow tenant_admin, only platform_admin/super_admin —
  // this alias must not grant a wider audience than the real module does.
  app.get("/v1/admin/domains", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CUSTOM_DOMAIN_ADMIN);
    const rows = await scopedRead((tx) => tx.select().from(customDomains).where(eq(customDomains.tenantId, ctx.tenantId)));
    return reply.send({ data: rows, meta: pageMeta(Math.max(rows.length, 1), 0, rows.length) });
  });

  // ─── SIEM alerts — real, backed by admin-service's own security-incident store ───
  // Kept at ROLES (tenant_admin included): this is a read-only aggregate
  // summary for the tenant-admin Security Center dashboard, not the incident
  // management CRUD surface (which stays gated to security_admin+ in
  // security-incident/routes.ts). No write capability is exposed here.
  app.get("/v1/admin/siem/alerts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const incidents = await incidentRepo.listIncidents(ctx.tenantId);
    const alerts = (incidents as Array<{ id: string; detectedAt: unknown; title: string; severity: string; category: string; status: string }>).map((i) => ({
      id: i.id,
      timestamp: toIso(i.detectedAt),
      title: i.title,
      severity: i.severity,
      source: i.category,
      status: i.status,
    }));
    return reply.send({ data: alerts, meta: pageMeta(Math.max(alerts.length, 1), 0, alerts.length) });
  });

  // ─── Feature flags (test-compat alias — canonical is /v1/admin/feature-flags/manage) ───
  // Tightened to FEATURE_FLAG_ADMIN: the canonical feature-flags module does
  // not allow tenant_admin either.
  app.get("/v1/admin/features", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FEATURE_FLAG_ADMIN);
    const rows = await scopedRead((tx) => tx.select().from(featureFlags).where(eq(featureFlags.tenantId, ctx.tenantId)));
    return reply.send({ data: rows, meta: pageMeta(Math.max(rows.length, 1), 0, rows.length) });
  });

  app.patch("/v1/admin/features/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FEATURE_FLAG_ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const updateBody = z.object({
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).optional(),
      enabled: z.boolean().optional(),
      rolloutPercent: z.number().int().min(0).max(100).optional(),
      targetSegments: z.array(z.string().min(1).max(100)).optional(),
      owner: z.string().max(160).optional(),
      expiresAt: z.string().datetime().nullable().optional(),
    });
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    if (Object.keys(parsed.data).length === 0) throw new HttpError(400, "EMPTY_BODY", "at least one field must be provided");
    const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as featureFlagCommands.FlagUpdatePayload;
    // Async command → real consumer (feature-flags/consumer.ts) applies the
    // write. 202, not the old fabricated `{updated:true}` synchronous lie.
    const result = await featureFlagCommands.flagUpdate(ctx, id, patch);
    return reply.code(202).send(result);
  });

  // ─── Users — real, forwarded to identity-service's own user directory ───
  app.get("/v1/admin/users", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { status, body } = await callUpstream<unknown>(
      req, ctx, "GET", identityBaseUrl(),
      `/identity/users?tenantId=${encodeURIComponent(ctx.tenantId)}&limit=${q.limit}&offset=${q.offset}`,
    );
    if (status < 200 || status >= 300) { const r = relayError(status, body); return reply.code(r.status).send(r.payload); }
    const rows = Array.isArray(body) ? body : [];
    return reply.send({ data: rows, meta: pageMeta(q.limit, q.offset, rows.length) });
  });

  app.post("/v1/admin/users", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const createBody = z.object({
      email: z.string().email().max(254),
      name: z.string().min(1).max(200),
      empCode: z.string().max(64).optional(),
    });
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const { status, body } = await callUpstream(req, ctx, "POST", identityBaseUrl(), "/identity/users", parsed.data);
    if (status < 200 || status >= 300) { const r = relayError(status, body); return reply.code(r.status).send(r.payload); }
    // Real async-accepted response from identity-service (id/status/correlationId)
    // — replaces the old `reply.code(201).send({id: randomUUID()})` that created
    // nothing at all.
    return reply.code(status).send(body);
  });

  app.patch("/v1/admin/users/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const updateBody = z.object({ name: z.string().min(1).max(200).optional(), empCode: z.string().max(64).optional() })
      .refine((b) => b.name !== undefined || b.empCode !== undefined, { message: "at least one of name, empCode required" });
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const { status, body } = await callUpstream(req, ctx, "PATCH", identityBaseUrl(), `/identity/users/${id}`, parsed.data);
    if (status < 200 || status >= 300) { const r = relayError(status, body); return reply.code(r.status).send(r.payload); }
    return reply.code(status).send(body);
  });

  // ─── User status (suspend/activate) — real, forwarded to identity-service's
  // own status command (COMP-012 previously filed this as unbuilt; identity-
  // service already had PATCH /identity/users/:id/status, admin-service just
  // never proxied it — fixed here as part of COMP-004's admin/users wiring). ───
  app.patch("/v1/admin/users/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const statusBody = z.object({
      status: z.enum(["active", "suspended", "locked", "deactivated"]),
      reason: z.string().min(3).max(500).optional(),
    });
    const parsed = statusBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const { status, body } = await callUpstream(req, ctx, "PATCH", identityBaseUrl(), `/identity/users/${id}/status`, parsed.data);
    if (status < 200 || status >= 300) { const r = relayError(status, body); return reply.code(r.status).send(r.payload); }
    return reply.code(status).send(body);
  });

  // ─── Effective roles for a user — real, forwarded to identity-service RBAC ───
  app.get("/v1/admin/users/:id/roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { status, body } = await callUpstream<{ roles?: Array<{ id: string; key: string; name: string }> }>(
      req, ctx, "GET", identityBaseUrl(), `/identity/rbac/users/${id}/effective`,
    );
    if (status < 200 || status >= 300) { const r = relayError(status, body); return reply.code(r.status).send(r.payload); }
    return reply.send({ data: (body ?? {}).roles ?? [] });
  });

  // ─── User <-> role grants — real, diffed against identity-service's actual
  // per-role assign/revoke commands (no bulk "replace a user's roles" command
  // exists there, so — same pattern as PATCH /v1/admin/roles/:id/permissions
  // below — this computes the add/remove set and issues one real call per
  // change). ───
  app.patch("/v1/admin/users/:id/roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsedBody = z.object({ roleKeys: z.array(z.string()) }).safeParse(req.body);
    if (!parsedBody.success) {
      throw new HttpError(400, "VALIDATION_FAILED", "body must be { roleKeys: string[] } — the FULL desired role-key set for this user");
    }
    const desired = new Set(parsedBody.data.roleKeys);

    const effectiveRes = await callUpstream<{ roles?: Array<{ id: string; key: string }> }>(
      req, ctx, "GET", identityBaseUrl(), `/identity/rbac/users/${id}/effective`,
    );
    if (effectiveRes.status < 200 || effectiveRes.status >= 300) { const r = relayError(effectiveRes.status, effectiveRes.body); return reply.code(r.status).send(r.payload); }
    const currentRoles = (effectiveRes.body ?? {}).roles ?? [];
    const currentByKey = new Map(currentRoles.map((r) => [r.key, r.id]));

    const rolesRes = await callUpstream<Array<{ id: string; key: string }>>(req, ctx, "GET", identityBaseUrl(), "/identity/rbac/roles?limit=200&offset=0");
    if (rolesRes.status < 200 || rolesRes.status >= 300) { const r = relayError(rolesRes.status, rolesRes.body); return reply.code(r.status).send(r.payload); }
    const roleIdByKey = new Map((Array.isArray(rolesRes.body) ? rolesRes.body : []).map((r) => [r.key, r.id]));

    const toGrant = [...desired].filter((k) => !currentByKey.has(k));
    const toRevoke = [...currentByKey.keys()].filter((k) => !desired.has(k));

    const applied: { granted: string[]; revoked: string[]; skipped: string[] } = { granted: [], revoked: [], skipped: [] };
    for (const key of toGrant) {
      const roleId = roleIdByKey.get(key);
      if (!roleId) { applied.skipped.push(key); continue; }
      const res = await callUpstream(req, ctx, "POST", identityBaseUrl(), `/identity/rbac/roles/${roleId}/assignments`, { userId: id });
      if (res.status < 200 || res.status >= 300) { const r = relayError(res.status, res.body); return reply.code(r.status).send(r.payload); }
      applied.granted.push(key);
    }
    for (const key of toRevoke) {
      const roleId = currentByKey.get(key);
      if (!roleId) { applied.skipped.push(key); continue; }
      const res = await callUpstream(req, ctx, "DELETE", identityBaseUrl(), `/identity/rbac/roles/${roleId}/assignments/${id}`);
      if (res.status < 200 || res.status >= 300) { const r = relayError(res.status, res.body); return reply.code(r.status).send(r.payload); }
      applied.revoked.push(key);
    }
    return reply.code(202).send({ userId: id, status: "accepted", ...applied });
  });

  // ─── MFA users — real, mfaEnabled is a genuine column on identity-service's user row ───
  app.get("/v1/admin/mfa/users", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { status, body } = await callUpstream<unknown>(
      req, ctx, "GET", identityBaseUrl(),
      `/identity/users?tenantId=${encodeURIComponent(ctx.tenantId)}&limit=${q.limit}&offset=${q.offset}`,
    );
    if (status < 200 || status >= 300) { const r = relayError(status, body); return reply.code(r.status).send(r.payload); }
    const rows = (Array.isArray(body) ? body : []) as Array<{ id: string; name: string; email: string; mfaEnabled: boolean }>;
    // department/enrolledAt are not tracked at this layer — left honestly
    // blank/null rather than invented (the existing UsersTable component
    // already renders department as "—" unconditionally for the same reason).
    const data = rows.map((u) => ({ id: u.id, name: u.name, email: u.email, department: "", mfaStatus: u.mfaEnabled ? "enabled" : "disabled", enrolledAt: null }));
    return reply.send({ data, meta: pageMeta(q.limit, q.offset, data.length) });
  });

  // ─── Roles — real, forwarded to identity-service's RBAC store ───
  app.get("/v1/admin/roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { status, body } = await callUpstream<unknown>(req, ctx, "GET", identityBaseUrl(), `/identity/rbac/roles?limit=${q.limit}&offset=${q.offset}`);
    if (status < 200 || status >= 300) { const r = relayError(status, body); return reply.code(r.status).send(r.payload); }
    const rows = Array.isArray(body) ? body : [];
    return reply.send({ data: rows, meta: pageMeta(q.limit, q.offset, rows.length) });
  });

  app.post("/v1/admin/roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const createBody = z.object({
      key: z.string().min(1).max(64).regex(/^[a-z0-9_.:-]+$/, "lowercase key"),
      name: z.string().min(1).max(200),
      description: z.string().max(500).optional(),
    });
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const { status, body } = await callUpstream(req, ctx, "POST", identityBaseUrl(), "/identity/rbac/roles", parsed.data);
    if (status < 200 || status >= 300) { const r = relayError(status, body); return reply.code(r.status).send(r.payload); }
    // 202 Accepted (real async command), not the old `reply.code(201).send({id: randomUUID()})`
    // that created nothing — this is the flagship example the gap report cited.
    return reply.code(status).send(body);
  });

  // No PATCH /v1/admin/roles/:id — identity-service's RBAC domain has no
  // role-metadata-update command at all (create / list / get / grant-permission
  // / revoke-permission / assign-user / revoke-user, but nothing that renames
  // or redescribes an existing role). Building that command is a real feature,
  // not a wiring fix, so it is out of scope for this single gap — 501 is the
  // honest answer instead of the old `reply.send({id, updated:true})` that
  // updated nothing.
  app.patch("/v1/admin/roles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.code(501).send(NOT_IMPLEMENTED("role metadata update has no backing command in identity-service's RBAC domain yet"));
  });

  // ─── Permissions — real, forwarded to identity-service's RBAC store ───
  app.get("/v1/admin/permissions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { status, body } = await callUpstream<unknown>(req, ctx, "GET", identityBaseUrl(), `/identity/rbac/permissions?limit=${q.limit}&offset=${q.offset}`);
    if (status < 200 || status >= 300) { const r = relayError(status, body); return reply.code(r.status).send(r.payload); }
    const rows = Array.isArray(body) ? body : [];
    return reply.send({ data: rows, meta: pageMeta(q.limit, q.offset, rows.length) });
  });

  // ─── Role <-> permission grants — real, diffed against identity-service's
  // actual grant/revoke commands (no bulk "replace" command exists there, so
  // this computes the add/remove set and issues one real call per change). ───
  app.patch("/v1/admin/roles/:id/permissions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsedBody = z.object({ permissionKeys: z.array(z.string()) }).safeParse(req.body);
    if (!parsedBody.success) {
      throw new HttpError(400, "VALIDATION_FAILED", "body must be { permissionKeys: string[] } — the FULL desired permission-key set for this role");
    }
    const desired = new Set(parsedBody.data.permissionKeys);

    const roleRes = await callUpstream<{ permissions?: string[] } & Record<string, unknown>>(req, ctx, "GET", identityBaseUrl(), `/identity/rbac/roles/${id}`);
    if (roleRes.status < 200 || roleRes.status >= 300) { const r = relayError(roleRes.status, roleRes.body); return reply.code(r.status).send(r.payload); }
    const roleBody = (roleRes.body ?? {}) as { permissions?: string[] };
    const current = new Set(roleBody.permissions ?? []);

    const permsRes = await callUpstream<Array<{ id: string; key: string }>>(req, ctx, "GET", identityBaseUrl(), "/identity/rbac/permissions?limit=200&offset=0");
    if (permsRes.status < 200 || permsRes.status >= 300) { const r = relayError(permsRes.status, permsRes.body); return reply.code(r.status).send(r.payload); }
    const idByKey = new Map((Array.isArray(permsRes.body) ? permsRes.body : []).map((p) => [p.key, p.id]));

    const toGrant = [...desired].filter((k) => !current.has(k));
    const toRevoke = [...current].filter((k) => !desired.has(k));

    const applied: { granted: string[]; revoked: string[]; skipped: string[] } = { granted: [], revoked: [], skipped: [] };
    for (const key of toGrant) {
      const permId = idByKey.get(key);
      if (!permId) { applied.skipped.push(key); continue; }
      const res = await callUpstream(req, ctx, "POST", identityBaseUrl(), `/identity/rbac/roles/${id}/permissions`, { permissionId: permId });
      if (res.status < 200 || res.status >= 300) { const r = relayError(res.status, res.body); return reply.code(r.status).send(r.payload); }
      applied.granted.push(key);
    }
    for (const key of toRevoke) {
      const permId = idByKey.get(key);
      if (!permId) { applied.skipped.push(key); continue; }
      const res = await callUpstream(req, ctx, "DELETE", identityBaseUrl(), `/identity/rbac/roles/${id}/permissions/${permId}`);
      if (res.status < 200 || res.status >= 300) { const r = relayError(res.status, res.body); return reply.code(r.status).send(r.payload); }
      applied.revoked.push(key);
    }
    return reply.code(202).send({ roleId: id, status: "accepted", ...applied });
  });

  // ─── Audit logs — real, forwarded to audit-service's real event log ───
  // audit-service's own role gate (audit_officer/audit_admin/super_admin/
  // platform_admin) does NOT include tenant_admin — that is forwarded
  // honestly too: a tenant_admin caller gets a real 403 from audit-service
  // rather than the old fabricated `[]`, which is the correct behaviour for
  // a resource this platform deliberately restricts.
  app.get("/v1/admin/audit-logs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { status, body } = await callUpstream<unknown>(
      req, ctx, "GET", auditBaseUrl(),
      `/v1/audit/events?limit=${q.limit}&offset=${q.offset}`,
    );
    if (status < 200 || status >= 300) { const r = relayError(status, body); return reply.code(r.status).send(r.payload); }
    const rows = Array.isArray(body) ? body : [];
    return reply.send({ data: rows, meta: pageMeta(q.limit, q.offset, rows.length) });
  });

  // ─── Usage — real, forwarded to tenant-service's quota/usage tracker ───
  app.get("/v1/admin/usage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { status, body } = await callUpstream<{ resources?: Array<{ resource: string; limit: number; used: number; projectedOverageDate: string | null }> }>(
      req, ctx, "GET", tenantServiceBaseUrl(), "/v1/tenant/usage",
    );
    if (status < 200 || status >= 300) { const r = relayError(status, body); return reply.code(r.status).send(r.payload); }
    const ICONS: Record<string, string> = { users: "👥", storage: "💾", apiCalls: "🔌", api_calls: "🔌" };
    const UNITS: Record<string, string> = { users: "seats", storage: "GB", apiCalls: "calls", api_calls: "calls" };
    const resources = (body.resources ?? []).map((r) => ({
      resource: r.resource,
      label: r.resource.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      icon: ICONS[r.resource] ?? "📊",
      limit: r.limit,
      used: r.used,
      unit: UNITS[r.resource] ?? "",
      projectedOverageDate: r.projectedOverageDate,
    }));
    return reply.send({ data: resources, meta: pageMeta(Math.max(resources.length, 1), 0, resources.length) });
  });

  // ─── The remainder have no trustworthy real backing store to build on within
  // the scope of this single gap. Each 501s honestly instead of fabricating a
  // 2xx — see the module-level comment above for why per route. ───

  app.get("/v1/admin/security/overview", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.code(501).send(NOT_IMPLEMENTED(
      "no service in this platform tracks failed-login counts; activeSessions/trustedDevices/mfaAdoptionRate are individually queryable but this dashboard cannot be answered honestly as a whole until that gap is closed",
    ));
  });

  app.get("/v1/admin/idp/providers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.code(501).send(NOT_IMPLEMENTED("no distinct IdP-provider store exists; identity-service's own SAML config endpoint is itself an unfinished stub"));
  });

  app.get("/v1/admin/sso/providers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.code(501).send(NOT_IMPLEMENTED("no real SSO-provider store exists; identity-service's SAML config route (PUT/GET /v1/identity/saml/config) is itself a TODO stub that persists nothing, so there is nothing honest to relay yet"));
  });

  // ─── Org hierarchy ─── real, forwarded to tenant-service's org-hierarchy module ───
  // Correction (post-review): the original PR description/comment claimed
  // "no backing store anywhere in the platform" for org-hierarchy. That was
  // wrong — tenant-service/src/modules/org-hierarchy is a fully built,
  // registered module (tenant-service/src/app.ts) with a real `orgUnits`
  // Drizzle table (tenant.org_units, tenant-scoped) and a real tenant-scoped
  // read at GET /v1/org/hierarchy. Forwarded here using the exact same
  // caller's-own-bearer-token pattern as /v1/admin/usage above — NOT the
  // internal service-account seam — for the same reason: see upstream-
  // client.ts's module comment for why token-forwarding is the only safe
  // choice for these cross-service reads.
  app.get("/v1/admin/org-hierarchy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { status, body } = await callUpstream(
      req, ctx, "GET", tenantServiceBaseUrl(), "/v1/org/hierarchy",
    );
    if (status < 200 || status >= 300) { const r = relayError(status, body); return reply.code(r.status).send(r.payload); }
    return reply.send(body);
  });

  const ORG_UNIT_TYPES = ["department", "division", "section", "unit", "branch"] as const;

  // ─── Org hierarchy — create/rename/reparent, real, forwarded to the same
  // tenant-service org-hierarchy module as the GET above (COMP-004: the web
  // Org Hierarchy admin page previously edited a purely local tree and PUT a
  // shape no route ever accepted). tenant-service's own unit-type taxonomy is
  // flat (department/division/section/unit/branch, cycle-checked on
  // reparent) — it has no "Ministry" level, so the page's fixed 5-level
  // Ministry→Unit model was rebuilt around these real types. ───
  app.post("/v1/admin/org-hierarchy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const createBody = z.object({
      name: z.string().min(1).max(200),
      type: z.enum(ORG_UNIT_TYPES),
      parentId: z.string().uuid().optional(),
      headUserId: z.string().uuid().optional(),
      code: z.string().max(32).optional(),
    });
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const { status, body } = await callUpstream(req, ctx, "POST", tenantServiceBaseUrl(), "/v1/org/hierarchy", parsed.data);
    if (status < 200 || status >= 300) { const r = relayError(status, body); return reply.code(r.status).send(r.payload); }
    return reply.code(status).send(body);
  });

  app.patch("/v1/admin/org-hierarchy/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const updateBody = z.object({
      name: z.string().min(1).max(200).optional(),
      type: z.enum(ORG_UNIT_TYPES).optional(),
      parentId: z.string().uuid().nullable().optional(),
      headUserId: z.string().uuid().nullable().optional(),
      code: z.string().max(32).nullable().optional(),
    });
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    if (Object.keys(parsed.data).length === 0) throw new HttpError(400, "EMPTY_BODY", "at least one field must be provided");
    const { status, body } = await callUpstream(req, ctx, "PATCH", tenantServiceBaseUrl(), `/v1/org/hierarchy/${id}`, parsed.data);
    if (status < 200 || status >= 300) { const r = relayError(status, body); return reply.code(r.status).send(r.payload); }
    return reply.code(status).send(body);
  });
}
