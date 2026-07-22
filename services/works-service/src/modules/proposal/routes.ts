import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import { getProposal, listProposals } from "./repo.js";
import { canDaoFinalize, validateCoa } from "./domain.js";
import { paginationSchema } from "../masters/validators.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do", "sdo", "section_officer"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function proposalRoutes(app: FastifyInstance): Promise<void> {
  // List proposals
  app.get("/v1/works/proposals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = paginationSchema.parse(req.query);
    const data = await listProposals(ctx.tenantId, query.page, query.pageSize);
    return reply.send({ data, meta: { page: query.page, pageSize: query.pageSize, total: data.length } });
  });

  // Get proposal by id
  app.get("/v1/works/proposals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = req.params as { id: string };
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
    const id = await commands.publishProposalCreate(ctx, { ...body, type: "coa_map" });
    return reply.status(202).send({ id, status: "accepted" });
  });

  // Map office
  app.post("/v1/works/proposals/office-mapping", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.mapOfficeSchema.parse(req.body);
    const id = await commands.publishProposalCreate(ctx, { ...body, type: "office_map" });
    return reply.status(202).send({ id, status: "accepted" });
  });

  // DAO Finalize
  app.post("/v1/works/proposals/:id/dao-finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["dao", "works_admin", "super_admin"]);
    const { id } = req.params as { id: string };
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
}
