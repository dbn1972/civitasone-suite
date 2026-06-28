import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { transferBody, disposeBody, idParam } from "./validators.js";
import * as commands from "./commands.js";

const ASSET_ROLES = ["asset_manager", "asset_admin", "super_admin"];

export async function lifecycleRoutes(app: FastifyInstance): Promise<void> {
  app.patch("/v1/assets/assets/:id/transfer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transferBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.transferAsset(ctx, id, body));
  });

  app.patch("/v1/assets/assets/:id/dispose", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = idParam.parse(req.params);
    const body = disposeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.disposeAsset(ctx, id, body));
  });

  // Submit an asset disposal to eOffice for administrative approval. The eFile
  // is raised via the eOffice integration; the decision returns on
  // asset.disposal.file_decided and effects the disposal (asset → disposed) on
  // approval or cancels it on rejection. `:id` is the asset being disposed.
  app.post("/v1/assets/disposals/:id/submit-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = idParam.parse(req.params);
    const body = disposeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitDisposalForApproval(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
