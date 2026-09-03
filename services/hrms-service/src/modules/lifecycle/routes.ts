import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { hrmsPromotions, hrmsTransfers } from "./schema.js";
import { createTransferBody, createPromotionBody, issueOrderBody, relieveBody, joinBody, idParam } from "./validators.js";
import * as commands from "./commands.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export async function lifecycleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/lifecycle/promotions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsPromotions)
      .where(eq(hrmsPromotions.tenantId, ctx.tenantId))
      .orderBy(desc(hrmsPromotions.effectiveDate)));
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/lifecycle/promotions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createPromotionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPromotion(ctx, body as unknown as Record<string, unknown>));
  });

  app.get("/v1/hrms/lifecycle/transfers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsTransfers)
      .where(eq(hrmsTransfers.tenantId, ctx.tenantId))
      .orderBy(desc(hrmsTransfers.effectiveDate)));
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/lifecycle/transfers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createTransferBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTransfer(ctx, body as unknown as Record<string, unknown>));
  });

  app.post("/v1/hrms/lifecycle/transfers/:id/issue-order", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = issueOrderBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.issueTransferOrder(ctx, id, body as unknown as Record<string, unknown>));
  });

  app.post("/v1/hrms/lifecycle/transfers/:id/relieve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = relieveBody.parse(req.body);

    // Synchronous pre-check: the async consumer's transitionTransfer already
    // guards this (from: ["ordered"]), but only AFTER the route has replied
    // 202 (fire-and-forget publish) -- so relieving before the order was
    // issued was told "accepted" while the write silently no-op'd in the
    // consumer (0 rows matched `from`), leaving the transfer's real status
    // untouched with no visible error. Mirror the same read-then-guard
    // pattern used by rti/routes.ts and lifecycle/hold-routes.ts, before
    // publish, rather than relying on the consumer's guard alone.
    const existing = await scopedRead((tx) => tx.select().from(hrmsTransfers)
      .where(and(eq(hrmsTransfers.id, id), eq(hrmsTransfers.tenantId, ctx.tenantId)))
      .limit(1));
    const transfer = existing[0];
    if (!transfer) throw new HttpError(404, "NOT_FOUND", "transfer not found");
    if (transfer.status !== "ordered") {
      throw new HttpError(409, "INVALID_STATE", `transfer must be 'ordered' to relieve (currently '${transfer.status}')`);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.relieveTransfer(ctx, id, body as unknown as Record<string, unknown>));
  });

  app.post("/v1/hrms/lifecycle/transfers/:id/join", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = joinBody.parse(req.body);

    // Synchronous pre-check — same fake-success gap as relieve above, mirrored
    // against the consumer's join guard (from: ["relieved"]). Without this, a
    // double-join (joined -> joined) was told "accepted" while the second
    // write silently no-op'd.
    const existing = await scopedRead((tx) => tx.select().from(hrmsTransfers)
      .where(and(eq(hrmsTransfers.id, id), eq(hrmsTransfers.tenantId, ctx.tenantId)))
      .limit(1));
    const transfer = existing[0];
    if (!transfer) throw new HttpError(404, "NOT_FOUND", "transfer not found");
    if (transfer.status !== "relieved") {
      throw new HttpError(409, "INVALID_STATE", `transfer must be 'relieved' to join (currently '${transfer.status}')`);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.joinTransfer(ctx, id, body as unknown as Record<string, unknown>));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
