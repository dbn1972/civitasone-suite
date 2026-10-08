/**
 * Quarters routes — residential quarter allotment workflow (SVC-058).
 * Maker-checker enforced on allotment (allotter ≠ applicant).
 */
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  idParam, createQuarterBody, applyAllotmentBody, allotBody,
  occupyBody, vacationNoticeBody, vacateBody, cancelBody, createLicenceFeeRateBody,
  quarterQueryParams, licenceFeeQueryParams,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ESTAB_ROLES  = ["estab_officer", "estab_admin", "quarter_officer", "super_admin"];
const READER_ROLES = [...ESTAB_ROLES, "audit_officer", "employee"];
// GAP2-ESTAB-QUARTERS-RATEAUTHZ-01: the licence-fee rate schedule is the master
// money table that drives recurring payroll salary deductions and finance
// receivables for every occupant. Configuring it must be an administrator-level
// control (consistent with approval-rules / operators), NOT the ordinary
// estab_officer. Writes are therefore gated to admin roles only.
const RATE_ADMIN_ROLES = ["estab_admin", "super_admin"];

export async function quartersRoutes(app: FastifyInstance): Promise<void> {
  // ── Quarter inventory ──────────────────────────────────────────────────
  app.post("/v1/estab/quarters", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = createQuarterBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createQuarter(ctx, body));
  });

  app.get("/v1/estab/quarters", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = quarterQueryParams.parse(req.query);
    return reply.send({ data: await queries.listQuarters(ctx.tenantId, q) });
  });

  // GAP-ESTAB-QUARTERS-01: summary counts for the stat tiles (computed from DB,
  // not by counting a capped page of rows). Registered before /:id to avoid
  // Fastify matching "summary" as an id parameter.
  app.get("/v1/estab/quarters/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    return reply.send({ data: await queries.getQuarterSummary(ctx.tenantId) });
  });

  app.get("/v1/estab/quarters/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const quarter = await queries.getQuarter(ctx.tenantId, id);
    if (!quarter) throw new HttpError(404, "NOT_FOUND", "quarter not found");
    return reply.send({ data: quarter });
  });

  // ── Allotment workflow ─────────────────────────────────────────────────
  app.post("/v1/estab/quarter-allotments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES); // employees can apply
    const body = applyAllotmentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.applyForAllotment(ctx, body));
  });

  app.patch("/v1/estab/quarter-allotments/:id/allot", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = allotBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.allotQuarter(ctx, id, body));
  });

  app.patch("/v1/estab/quarter-allotments/:id/occupy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = occupyBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.occupyQuarter(ctx, id, body));
  });

  app.patch("/v1/estab/quarter-allotments/:id/vacation-notice", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = vacationNoticeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.issueVacationNotice(ctx, id, body));
  });

  app.patch("/v1/estab/quarter-allotments/:id/vacate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = vacateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.vacateQuarter(ctx, id, body));
  });

  // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-05: cancel/reject an application.
  app.patch("/v1/estab/quarter-allotments/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = cancelBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.cancelAllotment(ctx, id, body));
  });

  app.get("/v1/estab/quarter-allotments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = quarterQueryParams.parse(req.query);
    const { rows, total } = await queries.listAllotments(ctx.tenantId, q);
    return reply.send({ data: rows, total });
  });

  // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-02: fetch a single allotment by id
  // so the detail page doesn't over-fetch the whole list and .find().
  app.get("/v1/estab/quarter-allotments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const allotment = await queries.getAllotment(ctx.tenantId, id);
    if (!allotment) throw new HttpError(404, "NOT_FOUND", "allotment not found");
    return reply.send({ data: allotment });
  });

  // ── Licence-fee rates (config) ─────────────────────────────────────────
  // GAP2-ESTAB-QUARTERS-RATEAUTHZ-01: admin-only write (see RATE_ADMIN_ROLES).
  app.post("/v1/estab/quarter-licence-fees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RATE_ADMIN_ROLES);
    const body = createLicenceFeeRateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createLicenceFeeRate(ctx, body));
  });

  // GAP2-ESTAB-LICENCEFEE-RATE-UNBOUNDED-01: bound the list the same way
  // listQuarters/listAllotments are, so a long effective-dated history can't
  // trigger an unbounded tenant-wide read.
  app.get("/v1/estab/quarter-licence-fees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = licenceFeeQueryParams.parse(req.query);
    return reply.send({ data: await queries.listLicenceFeeRates(ctx.tenantId, q) });
  });
}
