import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import { getAwardById } from "./repo.js";
import { canDaoFinalizeAward, canDoFinalizeAward } from "./domain.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do", "sdo"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function tenderRoutes(app: FastifyInstance): Promise<void> {
  // Create pre-tender
  app.post("/v1/works/tenders/pre-tender", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createPreTenderSchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPreTenderCommand(ctx, body));
  });

  // Add quotation
  app.post("/v1/works/tenders/quotation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.addQuotationSchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addQuotationCommand(ctx, body));
  });

  // Create award
  app.post("/v1/works/tenders/award", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createAwardSchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAwardCommand(ctx, body));
  });

  // DAO-finalize award (level 1 of two-level agreement finalization)
  app.post("/v1/works/tenders/award/:id/dao-finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["dao", "works_admin", "super_admin"]);
    const body = v.finalizeAwardSchema.parse({ id: (req.params as { id: string }).id });
    const award = await getAwardById(ctx.tenantId, body.id);
    if (!award) throw new HttpError(404, "NOT_FOUND", "award not found");
    const check = canDaoFinalizeAward(award.status);
    if (!check.allowed) throw new HttpError(422, "FINALIZATION_BLOCKED", check.reason!);

    return sendAccepted(reply, acceptedResponseSchema, await commands.daoFinalizeAwardCommand(ctx, body.id));
  });

  // DO-finalize award (level 2 — requires DAO finalization first)
  app.post("/v1/works/tenders/award/:id/do-finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["do", "works_admin", "super_admin"]);
    const body = v.finalizeAwardSchema.parse({ id: (req.params as { id: string }).id });
    const award = await getAwardById(ctx.tenantId, body.id);
    if (!award) throw new HttpError(404, "NOT_FOUND", "award not found");
    const check = canDoFinalizeAward(award.status);
    if (!check.allowed) throw new HttpError(422, "FINALIZATION_BLOCKED", check.reason!);

    return sendAccepted(reply, acceptedResponseSchema, await commands.doFinalizeAwardCommand(ctx, body.id));
  });
}
