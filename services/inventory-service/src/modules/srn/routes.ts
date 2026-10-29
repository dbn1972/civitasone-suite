/**
 * srn HTTP routes — Store Receipt Note (SRN) create, sign, and read.
 * Reads are tenant-scoped; writes are role-gated and run through the queue.
 *
 * Requirements: 1.1
 */
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, registerErrorHandler, HttpError } from "../../shared/context.js";
import { createSrnBody, signSrnBody, idParam, grnIdParam } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import { fetchGrn, ProcurementUnavailableError } from "./grn-client.js";
import { canCreateSrn } from "./domain.js";

const WRITE_ROLES  = ["store_officer", "inventory_manager", "inventory_admin", "warehouse_officer", "super_admin"];
const READER_ROLES = [...WRITE_ROLES, "procurement_officer", "procurement_admin", "finance_officer", "audit_officer"];

export async function srnRoutes(app: FastifyInstance): Promise<void> {
  // ── Create SRN ────────────────────────────────────────────────────────────
  app.post("/v1/inventory/srn", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createSrnBody.parse(req.body);
    // Synchronous GFR-149 pre-check: an SRN needs an accepted GRN. Answer now instead of returning 202 and
    // letting the consumer fail with GRN_NOT_ACCEPTED / GRN_NOT_FOUND. If procurement-service is unreachable
    // we cannot tell, so fall through and let the (retrying) consumer decide; it re-enforces the gate.
    try {
      const grn = await fetchGrn(ctx.tenantId, body.grnId);
      if (!grn) throw new HttpError(404, "GRN_NOT_FOUND", "GRN not found");
      if (!canCreateSrn({ status: grn.status } as Parameters<typeof canCreateSrn>[0])) {
        throw new HttpError(409, "GRN_NOT_ACCEPTED", `GRN must be accepted before an SRN can be raised (status: ${grn.status})`);
      }
    } catch (err) {
      if (!(err instanceof ProcurementUnavailableError)) throw err;
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createSrn(ctx, body));
  });

  // ── Sign SRN ──────────────────────────────────────────────────────────────
  app.patch("/v1/inventory/srn/:id/sign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = signSrnBody.parse(req.body ?? {});
    // UAT W6-A: tenant-scoped existence read; unknown SRN answers 404, not 202.
    if (!(await repo.getSrn(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "SRN not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.signSrn(ctx, id, body));
  });

  // ── Get SRN by ID ─────────────────────────────────────────────────────────
  app.get("/v1/inventory/srn/id/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const record = await repo.getSrn(ctx.tenantId, id);
    if (!record) throw new HttpError(404, "NOT_FOUND", "SRN not found");
    return reply.send({ data: record });
  });

  // ── Get SRN by GRN id (design.md contract: GET /v1/inventory/srn/:grnId) ──
  app.get("/v1/inventory/srn/:grnId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { grnId } = grnIdParam.parse(req.params);
    const record = await repo.findByGrnId(ctx.tenantId, grnId);
    return reply.send({ data: record ?? null });
  });

  registerErrorHandler(app);
}
