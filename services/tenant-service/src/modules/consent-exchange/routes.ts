/**
 * consent-exchange HTTP routes (SVC-150). Lifecycle mutations (request/grant/
 * deny/revoke/holding) are async commands (202 -> consumer). The fetch is the
 * one synchronous path: it evaluates consent and returns the in-scope data
 * (200) or a 403 with the deny reason, and is always written to the ledger.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";

// Requesting-side officers (raise a request, register held data, perform fetch).
const REQUESTER = ["data_requester", "dept_officer", "consent_officer", "tenant_admin", "platform_admin", "super_admin"];
// The data-principal or an authorised officer (grant / deny / revoke).
const GRANTOR = ["data_principal", "consent_officer", "grievance_officer", "tenant_admin", "platform_admin", "super_admin"];
// Transparency reads (DPDP s.11) — principal or any authorised officer.
const VIEWER = [...new Set([...REQUESTER, ...GRANTOR])];

// Roles authorised to act on a data-principal's consent ON THEIR BEHALF
// (grievance redressal, consent/DPB officer, tenant admin). A caller who is
// ONLY a data_principal may act solely on their OWN artefact. Anyone outside
// this explicit allow-list acting on a consent that isn't theirs is denied.
const CONSENT_OVERRIDE = ["consent_officer", "grievance_officer", "tenant_admin", "platform_admin", "super_admin"];

/**
 * AUTHZ (CRITICAL): binds a grant/deny/revoke to the acting principal. An
 * authorised override role (CONSENT_OVERRIDE) may act on behalf of the citizen;
 * otherwise the acting principal identity (ctx.actorId, the token `sub`) MUST
 * equal the artefact's principalId. Default-deny for a mismatched data_principal.
 */
function assertOwnConsent(ctx: RequestContext, artefact: { principalId: string }): void {
  if (hasAnyRole(ctx, CONSENT_OVERRIDE)) return;
  if (ctx.actorId !== artefact.principalId) {
    throw new HttpError(403, "NOT_YOUR_CONSENT", "you may only act on your own consent");
  }
}

const FREQ = ["one-time", "recurring"] as const;
const categories = z.array(z.string().min(1).max(120)).min(1).max(64);

export async function consentExchangeRoutes(app: FastifyInstance): Promise<void> {
  // ── request consented data ────────────────────────────────────────
  app.post("/v1/consent/requests", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, REQUESTER);
    const body = z.object({
      principalId: z.string().uuid(),
      requestingDept: z.string().min(1).max(160),
      providingDept: z.string().min(1).max(160),
      purposeKey: z.string().min(1).max(120),
      dataCategories: categories,
      validFrom: z.string().datetime(),
      validTo: z.string().datetime(),
      frequency: z.enum(FREQ).default("one-time"),
    }).parse(req.body);
    if (new Date(body.validTo) <= new Date(body.validFrom)) throw new HttpError(400, "INVALID_WINDOW", "validTo must be after validFrom");
    const id = randomUUID();
    await queue.publish("tenant.consent.request", envelope(ctx, "tenant.consent.request", { id, tenantId: ctx.tenantId, ...body }));
    return reply.code(202).send({ data: { id, status: "requested" } });
  });

  app.get("/v1/consent/requests", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, VIEWER);
    const q = z.object({ principalId: z.string().uuid().optional(), status: z.string().max(16).optional() }).parse(req.query);
    const data = await repo.listArtefacts(ctx.tenantId, q);
    return reply.send({ data, meta: { total: data.length } });
  });

  app.get("/v1/consent/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, VIEWER);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const artefact = await repo.findArtefact(ctx.tenantId, id);
    if (!artefact) throw new HttpError(404, "NOT_FOUND", "consent artefact not found");
    return reply.send({ data: artefact });
  });

  // ── grant / deny (principal or authorised officer) ────────────────
  app.post("/v1/consent/:id/grant", (req, reply) => decide(req, reply, "grant"));
  app.post("/v1/consent/:id/deny", (req, reply) => decide(req, reply, "deny"));

  async function decide(req: FastifyRequest, reply: FastifyReply, kind: "grant" | "deny"): Promise<unknown> {
    const ctx = resolveContext(req); requireRole(ctx, GRANTOR);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ reason: z.string().max(2000).optional() }).parse(req.body ?? {});
    const artefact = await repo.findArtefact(ctx.tenantId, id);
    if (!artefact) throw new HttpError(404, "NOT_FOUND", "consent artefact not found");
    assertOwnConsent(ctx, artefact);
    if (artefact.status !== "requested") throw new HttpError(409, "INVALID_STATE", `cannot ${kind} a consent in status ${artefact.status}`);
    await queue.publish(`tenant.consent.${kind}`, envelope(ctx, `tenant.consent.${kind}`, { id, tenantId: ctx.tenantId, reason: body.reason }));
    return reply.code(202).send({ data: { id, status: kind === "grant" ? "active" : "denied" } });
  }

  // ── revoke (principal can revoke anytime) ─────────────────────────
  app.post("/v1/consent/:id/revoke", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, GRANTOR);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const artefact = await repo.findArtefact(ctx.tenantId, id);
    if (!artefact) throw new HttpError(404, "NOT_FOUND", "consent artefact not found");
    assertOwnConsent(ctx, artefact);
    if (artefact.status === "revoked") throw new HttpError(409, "ALREADY_REVOKED", "consent already revoked");
    await queue.publish("tenant.consent.revoke", envelope(ctx, "tenant.consent.revoke", { id, tenantId: ctx.tenantId }));
    return reply.code(202).send({ data: { id, status: "revoked" } });
  });

  // ── providing dept registers held data (source for fetch) ─────────
  app.post("/v1/consent/holdings", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, REQUESTER);
    const body = z.object({
      principalId: z.string().uuid(),
      providingDept: z.string().min(1).max(160),
      category: z.string().min(1).max(120),
      value: z.record(z.unknown()).default({}),
    }).parse(req.body);
    // AUTHZ (CRITICAL): only the providing department may register the data it
    // holds. Bind the caller's department to the holding's providingDept.
    if (ctx.deptCode !== body.providingDept) throw new HttpError(403, "DEPT_MISMATCH", "you may only register holdings for your own department");
    const id = randomUUID();
    await queue.publish("tenant.consent.holding.upsert", envelope(ctx, "tenant.consent.holding.upsert", { id, tenantId: ctx.tenantId, ...body }));
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  // ── fetch consented data (synchronous, enforced, logged) ──────────
  app.post("/v1/consent/:id/fetch", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, REQUESTER);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ purposeKey: z.string().min(1).max(120), categories }).parse(req.body);
    const result = await repo.performFetch(ctx.tenantId, id, body, { actorId: ctx.actorId, correlationId: ctx.correlationId, deptCode: ctx.deptCode });
    if (!result.allowed) {
      if (result.reason === "NOT_FOUND") throw new HttpError(404, "NOT_FOUND", "consent artefact not found");
      // Cross-department fetch attempt: caller dept != artefact.requestingDept.
      if (result.reason === "DEPT_MISMATCH") return reply.code(403).send({ code: "DEPT_MISMATCH", message: "fetch denied: requesting department mismatch" });
      return reply.code(403).send({ code: "CONSENT_DENIED", reason: result.reason, message: `fetch denied: ${result.reason}` });
    }
    return reply.send({ data: { artefactId: result.artefactId, records: result.data }, meta: { total: result.data.length } });
  });

  // ── access ledger (data-principal transparency, DPDP s.11) ────────
  app.get("/v1/consent/principals/:principalId/ledger", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, VIEWER);
    const { principalId } = z.object({ principalId: z.string().uuid() }).parse(req.params);
    const data = await repo.listLedgerByPrincipal(ctx.tenantId, principalId);
    return reply.send({ data, meta: { total: data.length } });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}

// messageId is a fresh id per command (NOT the resource id): several commands
// target the same artefact id, and reusing it as the messageId would make the
// consumer's markProcessed() dedupe the second command as a replay.
function envelope(ctx: { tenantId: string; actorId: string; correlationId: string }, type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload };
}
