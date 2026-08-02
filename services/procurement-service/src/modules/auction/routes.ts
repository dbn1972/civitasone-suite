import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createAuctionBody, submitBidBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...PROC_ROLES, "audit_officer"];

export async function auctionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/procurement/auctions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const data = await queries.listAuctions(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data, meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: data.length } });
  });

  app.post("/v1/procurement/auctions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createAuctionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAuction(ctx, body));
  });

  app.post("/v1/procurement/auctions/:id/bids", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...PROC_ROLES, "vendor_portal"]);
    const { id } = idParam.parse(req.params);
    const body = submitBidBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitBid(ctx, id, body));
  });

  app.patch("/v1/procurement/auctions/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.closeAuction(ctx, id));
  });

  app.get("/v1/procurement/auctions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const auction = await queries.getAuction(id, ctx.tenantId);
    if (!auction) throw new HttpError(404, "NOT_FOUND", "auction not found");
    return reply.send(auction);
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
