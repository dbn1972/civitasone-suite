/**
 * Outsourced (vendor-supplied) workforce register -- GAP-HR-OUTSOURCED-01.
 *
 *   GET   /v1/hrms/outsourced        paged contract register + real total + whole-tenant stats
 *   POST  /v1/hrms/outsourced        add a vendor contract            (202, async command)
 *   PATCH /v1/hrms/outsourced/:id    update headcount / end / value / status (202, async command)
 *
 * Contract-level data only (vendor, service, headcount, window, value in paise);
 * outsourced staff are the vendor's employees and never enter the employee register.
 * Writes are queued commands applied (and audited) by outsourced/consumer.ts -- routes
 * never write Postgres directly.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { createOutsourcedBody, updateOutsourcedBody, listOutsourcedQuery, idParam } from "./validators.js";
import * as queries from "./queries.js";
import type { OutsourcedContractRow } from "./schema.js";

const OUTSOURCED_ROLES = ["hr_admin", "hr_officer", "super_admin"];

/** Today in IST (YYYY-MM-DD): contract windows are civil dates in India. */
function todayIst(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function view(r: OutsourcedContractRow) {
  return {
    id: r.id,
    vendorName: r.vendorName,
    serviceCategory: r.serviceCategory,
    contractRef: r.contractRef,
    headcount: r.headcount,
    contractStart: r.contractStart,
    contractEnd: r.contractEnd,
    // paise as a string: bigint is not JSON-safe and must never pass through a float
    contractValueMinor: r.contractValueMinor.toString(),
    status: r.status,
    remarks: r.remarks,
    version: r.version,
  };
}

export async function outsourcedRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/outsourced", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OUTSOURCED_ROLES);
    const q = listOutsourcedQuery.parse(req.query ?? {});
    const { rows, total, stats } = await queries.listContracts(ctx.tenantId, {
      limit: q.limit, offset: q.offset, ...(q.status ? { status: q.status } : {}), today: todayIst(),
    });
    return reply.send({
      data: rows.map(view),
      total,
      hasMore: q.offset + rows.length < total,
      stats,
    });
  });

  app.post("/v1/hrms/outsourced", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OUTSOURCED_ROLES);
    const body = createOutsourcedBody.parse(req.body ?? {});
    const id = randomUUID();
    await queue.publish(COMMANDS.outsourcedCreate, {
      messageId: randomUUID(), type: COMMANDS.outsourcedCreate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.patch("/v1/hrms/outsourced/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OUTSOURCED_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateOutsourcedBody.parse(req.body ?? {});
    const existing = await queries.findContract(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "outsourced contract not found");
    // A terminated contract is final: say so now instead of 202-ing a command
    // the consumer would silently drop.
    if (existing.status !== "active") throw new HttpError(409, "CONFLICT", "contract is terminated and cannot be changed");
    if (body.contractEnd !== undefined && body.contractEnd < existing.contractStart) {
      throw new HttpError(422, "VALIDATION_FAILED", "contractEnd must be on or after contractStart");
    }
    await queue.publish(COMMANDS.outsourcedUpdate, {
      messageId: randomUUID(), type: COMMANDS.outsourcedUpdate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
