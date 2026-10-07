import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import { getProposal, listProposals, updateProposal, countProposals, searchProposals, resolveProposals } from "./repo.js";
import { canDaoFinalize, validateCoa } from "./domain.js";
import { paginationSchema } from "../masters/validators.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do", "sdo", "section_officer"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function proposalRoutes(app: FastifyInstance): Promise<void> {
  // List proposals — also serves the shared EntityPicker (GAP-WORKS-BOQ-NEW-03):
  //   ?q=<text>        typeahead by work number / description
  //   ?ids=a,b,c       resolve a set of ids to {id, workNumber, description}
  // Both return the same compact row shape the picker adapter expects. Plain
  // (no q/ids) paginated listing is unchanged for every existing caller.
  app.get("/v1/works/proposals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const rawQuery = req.query as Record<string, unknown>;
    const idsParam = typeof rawQuery.ids === "string" ? rawQuery.ids : "";
    if (idsParam.trim().length > 0) {
      const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
      const data = await resolveProposals(ctx.tenantId, ids);
      return reply.send({ data });
    }
    const qParam = typeof rawQuery.q === "string" ? rawQuery.q : "";
    if (qParam.trim().length > 0) {
      const data = await searchProposals(ctx.tenantId, qParam, 20);
      return reply.send({ data });
    }
    const query = paginationSchema.parse(req.query);
    const data = await listProposals(ctx.tenantId, query.page, query.pageSize);
    // GAP-WORKS-PROPOSALS-06: meta.total must be the TRUE tenant row count, not
    // the current page length, or a client with more than pageSize proposals is
    // silently told there are only pageSize (same fix as GAP-WORKS-ORDERS-06).
    const total = await countProposals(ctx.tenantId);
    return reply.send({ data, meta: { page: query.page, pageSize: query.pageSize, total } });
  });

  // Alias: /v1/works/work-orders → same as proposals (UAT compat)
  app.get("/v1/works/work-orders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = paginationSchema.parse(req.query);
    const data = await listProposals(ctx.tenantId, query.page, query.pageSize);
    // GAP-WORKS-ORDERS-06: report the TRUE total row count, not data.length.
    // data.length only ever equals the current page size, so a client that
    // reads meta.total to paginate (or to know whether rows were truncated)
    // was silently told there were only `pageSize` work orders even when far
    // more existed. countProposals returns the tenant-scoped total.
    const total = await countProposals(ctx.tenantId);
    return reply.send({ data, meta: { page: query.page, pageSize: query.pageSize, total } });
  });

  // Get proposal by id
  app.get("/v1/works/proposals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const row = await getProposal(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "proposal not found");
    return reply.send({ data: row });
  });

  // Create proposal
  app.post("/v1/works/proposals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createProposalSchema.parse(req.body);
    const id = await commands.publishProposalCreate(ctx, body);
    return reply.status(202).send({ id, status: "accepted" });
  });

  // Split proposal
  app.post("/v1/works/proposals/split", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.splitProposalSchema.parse(req.body);
    const id = await commands.publishSplit(ctx, body);
    return reply.status(202).send({ id, status: "accepted" });
  });

  // Map COA
  app.post("/v1/works/proposals/coa", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.mapCoaSchema.parse(req.body);
    const validation = validateCoa(body);
    if (!validation.valid) {
      throw new HttpError(400, "INVALID_COA", validation.errors.join("; "));
    }
    const id = await commands.publishMapCoa(ctx, body);
    return reply.status(202).send({ id, status: "accepted" });
  });

  // Map office
  app.post("/v1/works/proposals/office-mapping", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.mapOfficeSchema.parse(req.body);
    const id = await commands.publishMapOffice(ctx, body);
    return reply.status(202).send({ id, status: "accepted" });
  });

  // DAO Finalize
  app.post("/v1/works/proposals/:id/dao-finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["dao", "works_admin", "super_admin"]);
    const { id } = v.idParamSchema.parse(req.params);
    const proposal = await getProposal(ctx.tenantId, id);
    if (!proposal) throw new HttpError(404, "NOT_FOUND", "proposal not found");

    const check = canDaoFinalize({
      id: proposal.id,
      status: proposal.status,
      description: proposal.description,
      workTypeId: proposal.workTypeId,
      estimatedCostMinor: proposal.estimatedCostMinor,
    });
    if (!check.allowed) {
      throw new HttpError(422, "FINALIZATION_BLOCKED", check.reason!);
    }

    await commands.publishDaoFinalize(ctx, id);
    return reply.status(202).send({ status: "accepted" });
  });

  // Update proposal (draft only)
  app.patch("/v1/works/proposals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const body = v.updateProposalSchema.parse(req.body);
    const existing = await getProposal(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "proposal not found");
    if (existing.status !== "draft") throw new HttpError(422, "NOT_DRAFT", "only draft proposals can be edited");
    await updateProposal(ctx.tenantId, id, body as Record<string, unknown>, ctx.actorId);
    const updated = await getProposal(ctx.tenantId, id);
    return reply.send({ data: updated });
  });
}
