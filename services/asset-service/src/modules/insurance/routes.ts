import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { policyBody, claimBody, idParam, policyQueryParams, claimQueryParams } from "./validators.js";
import * as commands from "./commands.js";
import { db, scopedRead } from "../../shared/db.js";
import { assetPolicies, assetClaims } from "./schema.js";
import { eq, and } from "drizzle-orm";
import { z as z2 } from "zod";
import * as queries from "./queries.js";

const ASSET_ROLES = ["asset_manager", "asset_admin", "super_admin"];
const READER_ROLES = [...ASSET_ROLES, "audit_officer"];

export async function insuranceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/assets/insurance/policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = policyBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPolicy(ctx, body));
  });

  app.get("/v1/assets/insurance/policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = policyQueryParams.parse(req.query);
    const opts: { assetId?: string; status?: string; limit: number; offset: number } = { limit: q.limit, offset: q.offset };
    if (q.assetId !== undefined) opts.assetId = q.assetId;
    if (q.status !== undefined) opts.status = q.status;
    const policies = await queries.listPolicies(ctx.tenantId, opts);
    return reply.send({ data: policies, limit: q.limit, offset: q.offset });
  });

  app.get("/v1/assets/insurance/policies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const policy = await queries.getPolicy(ctx.tenantId, id);
    if (!policy) throw new HttpError(404, "NOT_FOUND", "policy not found");
    return reply.send(policy);
  });

  app.post("/v1/assets/insurance/claims", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = claimBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createClaim(ctx, body));
  });

  app.get("/v1/assets/insurance/claims", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = claimQueryParams.parse(req.query);
    const opts: { policyId?: string; status?: string; limit: number; offset: number } = { limit: q.limit, offset: q.offset };
    if (q.policyId !== undefined) opts.policyId = q.policyId;
    if (q.status !== undefined) opts.status = q.status;
    const claims = await queries.listClaims(ctx.tenantId, opts);
    return reply.send({ data: claims, limit: q.limit, offset: q.offset });
  });

  app.get("/v1/assets/insurance/claims/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const claim = await queries.getClaim(ctx.tenantId, id);
    if (!claim) throw new HttpError(404, "NOT_FOUND", "claim not found");
    return reply.send(claim);
  });

  // ── Policy update/cancel ─────────────────────────────────────────────────
  app.patch("/v1/assets/insurance/policies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["asset_admin", "super_admin"]);
    const { id } = idParam.parse(req.params);
    const body = z2.object({
      status: z2.enum(["active", "expired", "cancelled"]).optional(),
      expiryDate: z2.string().optional(),
      premiumMinor: z2.number().int().nonnegative().optional(),
    }).parse(req.body);
    const existing = await queries.getPolicy(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "policy not found");
    const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: ctx.actorId };
    if (body.status !== undefined) patch.status = body.status;
    if (body.expiryDate !== undefined) patch.endDate = body.expiryDate;
    if (body.premiumMinor !== undefined) patch.premiumMinor = BigInt(body.premiumMinor);
    await db.update(assetPolicies).set(patch).where(and(eq(assetPolicies.id, id), eq(assetPolicies.tenantId, ctx.tenantId)));
    return reply.send({ id });
  });

  // ── Claim lifecycle ──────────────────────────────────────────────────────
  app.patch("/v1/assets/insurance/claims/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["asset_admin", "super_admin"]);
    const { id } = idParam.parse(req.params);
    const existing = await queries.getClaim(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "claim not found");
    await db.update(assetClaims)
      .set({ status: "approved", updatedAt: new Date(), updatedBy: ctx.actorId })
      .where(and(eq(assetClaims.id, id), eq(assetClaims.tenantId, ctx.tenantId)));
    return reply.send({ id });
  });

  app.patch("/v1/assets/insurance/claims/:id/settle", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["asset_admin", "super_admin"]);
    const { id } = idParam.parse(req.params);
    const body = z2.object({
      settlementAmountMinor: z2.number().int().nonnegative(),
      currency: z2.string().length(3).default("INR"),
    }).parse(req.body);
    const existing = await queries.getClaim(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "claim not found");
    await db.update(assetClaims)
      .set({
        status: "settled",
        settledAmountMinor: BigInt(body.settlementAmountMinor),
        updatedAt: new Date(),
        updatedBy: ctx.actorId,
      })
      .where(and(eq(assetClaims.id, id), eq(assetClaims.tenantId, ctx.tenantId)));
    return reply.send({ id });
  });

  app.patch("/v1/assets/insurance/claims/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["asset_admin", "super_admin"]);
    const { id } = idParam.parse(req.params);
    const body = z2.object({ reason: z2.string() }).parse(req.body);
    const existing = await queries.getClaim(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "claim not found");
    await db.update(assetClaims)
      .set({ status: "rejected", notes: body.reason, updatedAt: new Date(), updatedBy: ctx.actorId })
      .where(and(eq(assetClaims.id, id), eq(assetClaims.tenantId, ctx.tenantId)));
    return reply.send({ id });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
