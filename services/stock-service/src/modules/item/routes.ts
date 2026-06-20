import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createItemBody, itemQueryParams, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const STOCK_ROLES  = ["stock_manager", "stock_admin", "super_admin", "procurement_officer"];
const READER_ROLES = [...STOCK_ROLES, "audit_officer"];

export async function itemRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/stock/items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STOCK_ROLES);
    const body = createItemBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createItem(ctx, body));
  });

  app.get("/v1/stock/items/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const item = await queries.getItem(ctx.tenantId, id);
    if (!item) throw new HttpError(404, "NOT_FOUND", "item not found");
    return reply.send(item);
  });

  app.get("/v1/stock/items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = itemQueryParams.parse(req.query);
    const opts: { category?: string; limit: number; offset: number } = { limit: q.limit, offset: q.offset };
    if (q.category !== undefined) opts.category = q.category;
    const items = await queries.listItems(ctx.tenantId, opts);
    return reply.send({ data: items, limit: q.limit, offset: q.offset });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
