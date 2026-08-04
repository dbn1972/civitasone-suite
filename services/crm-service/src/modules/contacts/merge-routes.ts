/**
 * Merge routes for leads and accounts (DQ-002).
 *   POST /v1/crm/leads/merge     — merge two lead (contact) records
 *   POST /v1/crm/accounts/merge  — merge two account records
 * Both are admin-gated, mirroring POST /v1/crm/contacts/merge.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as mergeCommands from "./merge-commands.js";

const ADMIN_ROLES = ["crm_admin", "super_admin"];

const mergeBody = z.object({
  primaryId: z.string().uuid(),
  duplicateId: z.string().uuid(),
});

export async function mergeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/leads/merge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = mergeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await mergeCommands.mergeLeads(ctx, body));
  });

  app.post("/v1/crm/accounts/merge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = mergeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await mergeCommands.mergeAccounts(ctx, body));
  });
}
