import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import { resolveApprovalType, canFinalize, canEnterTS, isSelfApproval } from "./domain.js";
import { countAaForWork, countTsForWork, countAa, countTs, getAa, getTs, listAa, listTs } from "./repo.js";
import { getProposal } from "../proposal/repo.js";
import { paginationSchema } from "../masters/validators.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do", "sdo"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

const aaAcceptedSchema = acceptedResponseSchema.extend({ approvalType: z.string() });
const tsAcceptedSchema = acceptedResponseSchema.extend({ sanctionType: z.string() });

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  // Tenant-wide AA register (paginated) — the FE approvals list page.
  app.get("/v1/works/approvals/aa", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = paginationSchema.parse(req.query);
    const [data, total] = await Promise.all([
      listAa(ctx.tenantId, query.page, query.pageSize),
      countAa(ctx.tenantId),
    ]);
    // GAP2-WORKS-APPROVALS-05: report the REAL tenant total (not data.length,
    // which caps at pageSize and makes the register + stat cards undercount).
    return reply.send({ data, meta: { page: query.page, pageSize: query.pageSize, total } });
  });

  // Tenant-wide TS register (paginated) — the FE approvals list page.
  app.get("/v1/works/approvals/ts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = paginationSchema.parse(req.query);
    const [data, total] = await Promise.all([
      listTs(ctx.tenantId, query.page, query.pageSize),
      countTs(ctx.tenantId),
    ]);
    // GAP2-WORKS-APPROVALS-05: report the REAL tenant total (see aa route).
    return reply.send({ data, meta: { page: query.page, pageSize: query.pageSize, total } });
  });

  // Single AA by id (tenant-scoped) — the FE AA detail page. Added so a record
  // beyond the first list page is reachable directly instead of the FE having
  // to fetch a capped list and .find() it (which 404'd anything past row 100).
  app.get("/v1/works/approvals/aa/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const aa = await getAa(ctx.tenantId, id);
    if (!aa) throw new HttpError(404, "NOT_FOUND", "AA not found");
    return reply.send({ data: aa });
  });

  // Single TS by id (tenant-scoped) — the FE TS detail page. Same rationale as
  // the AA-by-id route above.
  app.get("/v1/works/approvals/ts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const ts = await getTs(ctx.tenantId, id);
    if (!ts) throw new HttpError(404, "NOT_FOUND", "TS not found");
    return reply.send({ data: ts });
  });

  // Create AA
  app.post("/v1/works/approvals/aa", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createAaSchema.parse(req.body);
    const count = await countAaForWork(ctx.tenantId, body.workId);
    const approvalType = resolveApprovalType(count);
    return sendValidated(reply, aaAcceptedSchema, await commands.createAaCommand(ctx, body, approvalType), 202);
  });

  // Finalize AA
  app.post("/v1/works/approvals/aa/:id/finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const aa = await getAa(ctx.tenantId, id);
    if (!aa) throw new HttpError(404, "NOT_FOUND", "AA not found");

    const check = canFinalize({ id: aa.id, status: aa.status });
    if (!check.allowed) throw new HttpError(422, "FINALIZATION_BLOCKED", check.reason!);

    // GAP2-WORKS-APPROVALS-01: maker-checker — the finalizer must differ from
    // the creator (two-person rule). A self-finalize is rejected 422.
    if (isSelfApproval(ctx.actorId, { createdBy: aa.createdBy })) {
      throw new HttpError(422, "SELF_APPROVAL_FORBIDDEN", "The creator of an AA cannot finalize it (maker-checker rule)");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.finalizeAaCommand(ctx, id));
  });

  // Create TS — requires DAO finalization (BR-011)
  app.post("/v1/works/approvals/ts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createTsSchema.parse(req.body);

    // BR-011: Check DAO gate
    const proposal = await getProposal(ctx.tenantId, body.workId);
    if (!proposal) throw new HttpError(404, "NOT_FOUND", "work proposal not found");

    const gate = canEnterTS(proposal.status);
    if (!gate.allowed) throw new HttpError(422, "DAO_GATE_BLOCKED", gate.blockingReason!);

    const count = await countTsForWork(ctx.tenantId, body.workId);
    const sanctionType = resolveApprovalType(count);
    return sendValidated(reply, tsAcceptedSchema, await commands.createTsCommand(ctx, body, sanctionType), 202);
  });

  // Finalize TS
  app.post("/v1/works/approvals/ts/:id/finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const ts = await getTs(ctx.tenantId, id);
    if (!ts) throw new HttpError(404, "NOT_FOUND", "TS not found");

    const check = canFinalize({ id: ts.id, status: ts.status });
    if (!check.allowed) throw new HttpError(422, "FINALIZATION_BLOCKED", check.reason!);

    // GAP2-WORKS-APPROVALS-01: maker-checker — the finalizer must differ from
    // the creator (two-person rule). A self-finalize is rejected 422.
    if (isSelfApproval(ctx.actorId, { createdBy: ts.createdBy })) {
      throw new HttpError(422, "SELF_APPROVAL_FORBIDDEN", "The creator of a TS cannot finalize it (maker-checker rule)");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.finalizeTsCommand(ctx, id));
  });
}
