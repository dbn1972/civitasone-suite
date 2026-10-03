/**
 * cycle-count HTTP routes — cycle count CRUD and approval workflow.
 * Reads are tenant-scoped; writes are role-gated and run through the queue.
 */
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, registerErrorHandler, HttpError } from "../../shared/context.js";
import {
  createCycleCountBody, approveCycleCountBody, rejectCycleCountBody,
  cycleCountQueryParams, idParam,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { resolveUserNames } from "../../shared/identity-client.js";

const WRITE_ROLES    = ["inventory_manager", "inventory_admin", "store_keeper", "super_admin"];
const APPROVE_ROLES  = ["inventory_manager", "inventory_admin", "super_admin"];
const READER_ROLES   = [...WRITE_ROLES, "inventory_user", "audit_officer", "finance_officer"];

export async function cycleCountRoutes(app: FastifyInstance): Promise<void> {
  // ── Create cycle count ────────────────────────────────────────────────────
  app.post("/v1/inventory/cycle-counts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createCycleCountBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCycleCount(ctx, body));
  });

  // ── Get cycle count by ID ─────────────────────────────────────────────────
  app.get("/v1/inventory/cycle-counts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const record = await queries.getCycleCount(ctx.tenantId, id);
    if (!record) throw new HttpError(404, "NOT_FOUND", "cycle count not found");
    // Display names for the audit trail (best-effort; absent when identity-service cannot name them).
    const names = await resolveUserNames(ctx.tenantId, [record.createdBy, record.approvedBy, record.rejectedBy]);
    const nameOf = (id: string | null): string | null => (id ? names.get(id) ?? null : null);
    return reply.send({
      data: {
        ...record,
        createdByName: nameOf(record.createdBy),
        approvedByName: nameOf(record.approvedBy),
        rejectedByName: nameOf(record.rejectedBy),
      },
    });
  });

  // ── List cycle counts ─────────────────────────────────────────────────────
  app.get("/v1/inventory/cycle-counts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = cycleCountQueryParams.parse(req.query);
    return reply.send(await queries.listCycleCounts(ctx.tenantId, q));
  });

  // ── Approve cycle count ───────────────────────────────────────────────────
  app.post("/v1/inventory/cycle-counts/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approveCycleCountBody.parse(req.body);
    // GAP-INVENTORY-CYCLE-COUNTS-DETAIL-02: synchronous pre-checks so the caller
    // gets a real answer instead of a 202 for a command the consumer would
    // silently drop. The consumer re-enforces all three atomically (version +
    // status guard in its UPDATE, and the maker!=checker guard).
    const record = await queries.getCycleCount(ctx.tenantId, id);
    if (!record) throw new HttpError(404, "NOT_FOUND", "cycle count not found");
    // Maker != checker: whoever created/counted the variance cannot approve the
    // stock write-off it triggers (applies to every role, including super_admin).
    if (record.createdBy === ctx.actorId) {
      throw new HttpError(403, "MAKER_CHECKER", "the user who recorded a cycle count cannot approve it");
    }
    if (record.status !== "pending_approval") {
      throw new HttpError(409, "NOT_PENDING_APPROVAL", `cycle count is already ${record.status}`);
    }
    if (record.version !== body.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "cycle count was changed by someone else; reload and retry");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveCycleCount(ctx, id, body.version));
  });

  // ── Reject cycle count ────────────────────────────────────────────────────
  app.post("/v1/inventory/cycle-counts/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectCycleCountBody.parse(req.body);
    // Maker != checker applies to the decision as a whole, so reject mirrors approve.
    const record = await queries.getCycleCount(ctx.tenantId, id);
    if (!record) throw new HttpError(404, "NOT_FOUND", "cycle count not found");
    if (record.createdBy === ctx.actorId) {
      throw new HttpError(403, "MAKER_CHECKER", "the user who recorded a cycle count cannot reject it");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectCycleCount(ctx, id, body.version, body.reason));
  });

  registerErrorHandler(app);
}
