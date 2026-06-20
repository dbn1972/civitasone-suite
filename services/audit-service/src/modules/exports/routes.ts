import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { resolveContext } from "../../shared/context.js";
import { createExportBody } from "./validators.js";
import * as commands from "./commands.js";

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.post("/audit/exports", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = createExportBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestExport(ctx, body));
  });
}
