/**
 * batches HTTP routes — batch CRUD, serial number registration, issue with batch validation.
 * Reads are tenant-scoped; writes are role-gated and run through the queue.
 */
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, registerErrorHandler, HttpError } from "../../shared/context.js";
import {
  createBatchBody, updateBatchBody, createSerialBody, issueFromBatchBody,
  quarantineBatchBody, recallBatchBody,
  batchQueryParams, serialQueryParams, idParam,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { validateBatchNotExpired } from "./domain.js";
import { DomainError } from "../../shared/domain.js";

const WRITE_ROLES  = ["inventory_user", "inventory_manager", "inventory_admin", "store_keeper", "super_admin"];
const READER_ROLES = [...WRITE_ROLES, "audit_officer", "finance_officer"];

export async function batchRoutes(app: FastifyInstance): Promise<void> {
  // ── Batches ──────────────────────────────────────────────────────────────
  app.post("/v1/inventory/batches", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createBatchBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createBatch(ctx, body));
  });

  app.get("/v1/inventory/batches/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const batch = await queries.getBatch(ctx.tenantId, id);
    if (!batch) throw new HttpError(404, "NOT_FOUND", "batch not found");
    return reply.send({ data: batch });
  });

  app.get("/v1/inventory/batches", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = batchQueryParams.parse(req.query);
    return reply.send(await queries.listBatches(ctx.tenantId, q));
  });

  // ── Issue from Batch (validates expiry) ──────────────────────────────────
  app.post("/v1/inventory/batches/issue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = issueFromBatchBody.parse(req.body);

    // Fetch batch to validate expiry before queueing
    const batch = await queries.getBatch(ctx.tenantId, body.batchId);
    if (!batch) throw new HttpError(404, "NOT_FOUND", "batch not found");

    try {
      validateBatchNotExpired(batch.expiryDate, body.postingDate);
    } catch (err) {
      if (err instanceof DomainError && err.code === "BATCH_EXPIRED") {
        throw new HttpError(422, "BATCH_EXPIRED", err.message);
      }
      throw err;
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.issueFromBatch(ctx, body));
  });

  // ── Serial Numbers ───────────────────────────────────────────────────────
  app.post("/v1/inventory/serials", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createSerialBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.registerSerial(ctx, body));
  });

  app.get("/v1/inventory/serials/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const serial = await queries.getSerial(ctx.tenantId, id);
    if (!serial) throw new HttpError(404, "NOT_FOUND", "serial number not found");
    return reply.send({ data: serial });
  });

  app.get("/v1/inventory/serials", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = serialQueryParams.parse(req.query);
    return reply.send(await queries.listSerials(ctx.tenantId, q));
  });

  // ── Quarantine & Recall (SVC-055) ────────────────────────────────────────
  app.patch("/v1/inventory/batches/:id/quarantine", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["inventory_manager", "inventory_admin", "qc_inspector", "super_admin"]);
    const { id } = idParam.parse(req.params);
    const body = quarantineBatchBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.quarantineBatch(ctx, id, body.reason));
  });

  app.post("/v1/inventory/batches/:id/recall", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["inventory_manager", "inventory_admin", "super_admin"]);
    const { id } = idParam.parse(req.params);
    const body = recallBatchBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recallBatch(ctx, id, body.reason, body.severity));
  });

  registerErrorHandler(app);
}
