import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createAssetBody, assetQueryParams, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ASSET_ROLES  = ["asset_manager", "asset_admin", "super_admin"];
const READER_ROLES = [...ASSET_ROLES, "audit_officer"];

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/assets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = createAssetBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAsset(ctx, body));
  });

  app.get("/v1/assets/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const asset = await queries.getAsset(ctx.tenantId, id);
    if (!asset) throw new HttpError(404, "NOT_FOUND", "asset not found");
    return reply.send(asset);
  });

  app.get("/v1/assets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = assetQueryParams.parse(req.query);
    const opts: { category?: string; status?: string; limit: number; offset: number } = { limit: q.limit, offset: q.offset };
    if (q.category !== undefined) opts.category = q.category;
    if (q.status !== undefined) opts.status = q.status;
    const assets = await queries.listAssets(ctx.tenantId, opts);
    return reply.send({ data: assets, limit: q.limit, offset: q.offset });
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
