import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createPipelineBody, updatePipelineBody, idParam, pipelineListQuery, pipelinesListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import * as dealsRepo from "../deals/repo.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
// GAP-CRM-PIPELINES-03: pipeline CONFIGURATION (create / edit / delete, stage gates,
// mandatory fields, scope) is an admin control -- the web route is admin-gated
// (crm/pipelines/layout.tsx), so the server must not stay open to every crm_user via the
// API. Reads stay on CRM_ROLES because the Kanban board, the opportunity views, the
// stage-limit editor and the quotation builder all read pipelines as a plain crm_user.
// Strictly narrower than the previous write set (CRM_ROLES minus crm_user): no role is
// granted anything new here.
const ADMIN_ROLES = ["crm_admin", "super_admin"];

export async function pipelineRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/pipelines", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createPipelineBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPipeline(ctx, body));
  });

  app.get("/v1/crm/pipelines", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = pipelineListQuery.parse(req.query ?? {});
    const scope = {
      ...(q.product !== undefined ? { product: q.product } : {}),
      ...(q.region !== undefined ? { region: q.region } : {}),
      ...(q.businessUnit !== undefined ? { businessUnit: q.businessUnit } : {}),
    };
    sendValidated(reply, pipelinesListSchema, await queries.listPipelines(ctx.tenantId, q.limit, q.offset, scope));
  });

  app.get("/v1/crm/pipelines/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const pipeline = await queries.getPipeline(id, ctx.tenantId);
    if (!pipeline) throw new HttpError(404, "NOT_FOUND", "pipeline not found");
    return reply.send({ data: pipeline });
  });

  app.patch("/v1/crm/pipelines/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updatePipelineBody.parse(req.body);

    // GAP-CRM-PIPELINES-01: removing a stage from a saved pipeline must not silently
    // orphan the open deals sitting in it. When the update narrows the stage set, refuse
    // (409 STAGE_IN_USE) if any removed stage still holds live deals, reporting the stage
    // and the count. Enforced synchronously here (a REJECT decision the 202/consumer path
    // can't report), by stage NAME — the identifier a deal actually persists in
    // crm.deals.stage. A pipeline with no deals, or whose removed stages are empty, is
    // unaffected.
    if (body.stages !== undefined) {
      const current = await repo.stagesOf(id, ctx.tenantId);
      if (current && current.length > 0) {
        const keptNames = new Set(body.stages.map((s) => s.name));
        const removedNames = current.map((s) => s.name).filter((n) => !keptNames.has(n));
        if (removedNames.length > 0) {
          const inUse = await dealsRepo.countOpenDealsInStages(ctx.tenantId, id, removedNames);
          if (inUse > 0) {
            throw new HttpError(
              409,
              "STAGE_IN_USE",
              `cannot remove stage(s) ${removedNames.join(", ")}: ${inUse} open deal(s) still reference them`,
            );
          }
        }
      }
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.updatePipeline(ctx, id, body));
  });

  app.delete("/v1/crm/pipelines/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    // GAP-CRM-PIPELINES-01: deleting a pipeline that still holds open deals would orphan
    // them (they'd vanish from boards while silently keeping a dangling pipeline_id).
    // Refuse (409 PIPELINE_IN_USE) and report the count so the UI can show it. Already-
    // closed/soft-deleted deals don't count — a historical reference must not block an
    // administrative delete. Synchronous REJECT, same rationale as the stage guard above.
    const openDeals = await dealsRepo.countOpenDealsByPipeline(ctx.tenantId, id);
    if (openDeals > 0) {
      throw new HttpError(
        409,
        "PIPELINE_IN_USE",
        `cannot delete pipeline: ${openDeals} open deal(s) still reference it`,
      );
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.deletePipeline(ctx, id));
  });
}
