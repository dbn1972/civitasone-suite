import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import { listBoqItems, getRecapitulation, listAllBoqItems, getBoqItemById } from "./repo.js";
import { canEnterBoq, canModifyBoq } from "./domain.js";
import { hasFinalizedTsForWork } from "../approval/repo.js";
import { hasTenderForWork, hasPreTenderForWork } from "../tender/repo.js";
import { getProposal } from "../proposal/repo.js";
import { paginationSchema } from "../masters/validators.js";

/** BR-015 input: "tender details exist" for the work (checks both the
 * populated pre_tenders table and — future-proofing — tenders). */
async function hasTenderDetailsForWork(tenantId: string, workId: string): Promise<boolean> {
  return (await hasTenderForWork(tenantId, workId)) || (await hasPreTenderForWork(tenantId, workId));
}

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "estimator", "sdo", "section_officer"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function boqRoutes(app: FastifyInstance): Promise<void> {
  // Tenant-wide BoQ index (paginated) — the FE BoQ list page.
  app.get("/v1/works/boq", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = paginationSchema.parse(req.query);
    const data = await listAllBoqItems(ctx.tenantId, query.page, query.pageSize);
    return reply.send({ data, meta: { page: query.page, pageSize: query.pageSize, total: data.length } });
  });

  // List BoQ items for a work
  //
  // Bug fix (works-deep-verify, MEDIUM/L1): this never checked that `workId`
  // refers to a real work — listBoqItems() just runs a WHERE that legitimately
  // (and silently) matches zero rows for ANY id, real or not. Confirmed live:
  // GET /v1/works/boq/<random-uuid> returned 200 {"data":[]}, identical to a
  // real work with no BoQ entered yet. Because the frontend
  // (apps/web/.../works/boq/[workId]/page.tsx) only calls notFound() when
  // BOTH the items call AND the recapitulation call report source:"error",
  // and the items call never failed, /works/boq/<bogus-id> rendered a normal
  // "Bill of Quantities" page instead of 404ing — the exact "detail routes
  // 404 cleanly for a bogus id" failure mode this pass targets. Every other
  // :id/:workId detail route in this service (contractor, masters, proposal)
  // already validates existence and 404s; this brings boq in line with that
  // convention instead of pushing the check into the frontend.
  app.get("/v1/works/boq/:workId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { workId } = req.params as { workId: string };
    const work = await getProposal(ctx.tenantId, workId);
    if (!work) throw new HttpError(404, "NOT_FOUND", "work not found");
    const data = await listBoqItems(ctx.tenantId, workId);
    return reply.send({ data });
  });

  // Get recapitulation for a work
  app.get("/v1/works/boq/:workId/recapitulation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { workId } = req.params as { workId: string };
    const data = await getRecapitulation(ctx.tenantId, workId);
    if (!data) throw new HttpError(404, "NOT_FOUND", "recapitulation not found");
    return reply.send({ data });
  });

  // Add BoQ item
  app.post("/v1/works/boq", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.addBoqItemSchema.parse(req.body);

    // BR-013: BoQ entry requires a finalized technical sanction (TS) to exist.
    const tsExists = await hasFinalizedTsForWork(ctx.tenantId, body.workId);
    if (!canEnterBoq(tsExists)) {
      throw new HttpError(422, "TS_REQUIRED", "BoQ entry requires a finalized technical sanction (TS) for this work");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.addBoqItemCommand(ctx, body));
  });

  // Recapitulate
  app.post("/v1/works/boq/recapitulate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.recapitulateSchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recapitulateCommand(ctx, body));
  });

  // Update BoQ item
  app.patch("/v1/works/boq/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.updateBoqItemSchema.parse({ ...(req.body as object), id: v.idParamSchema.parse(req.params).id });

    // BR-015: BoQ cannot be modified once tender details exist for the work.
    const existing = await getBoqItemById(ctx.tenantId, body.id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "BoQ item not found");
    if (!canModifyBoq(await hasTenderDetailsForWork(ctx.tenantId, existing.workId))) {
      throw new HttpError(409, "BOQ_FROZEN", "BoQ cannot be modified once tender details exist for this work");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateBoqItemCommand(ctx, body));
  });

  // Delete BoQ item
  app.delete("/v1/works/boq/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.deleteBoqItemSchema.parse({ id: v.idParamSchema.parse(req.params).id });

    // BR-015: BoQ cannot be modified (including deleted) once tender
    // details exist for the work.
    const existing = await getBoqItemById(ctx.tenantId, body.id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "BoQ item not found");
    if (!canModifyBoq(await hasTenderDetailsForWork(ctx.tenantId, existing.workId))) {
      throw new HttpError(409, "BOQ_FROZEN", "BoQ cannot be modified once tender details exist for this work");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteBoqItemCommand(ctx, body.id));
  });
}
