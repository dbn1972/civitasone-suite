import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createEsignRouteBody, esignRouteIdParam, signBody } from "./validators.js";
import {
  validateSignatories,
  canSign,
  applySignature,
  checkDeadlineStatus,
} from "./domain.js";
import type { SignatoryEntry } from "./schema.js";
import * as repo from "./repo.js";
import { cache, queue } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";

const WRITE_ROLES = ["procurement_admin", "finance_admin", "super_admin", "legal_officer", "contract_admin"];
const READ_ROLES = [...WRITE_ROLES, "audit_officer", "procurement_officer", "finance_officer"];

export async function esignRoutes(app: FastifyInstance): Promise<void> {
  // ── Create e-sign routing ─────────────────────────────────────────────
  app.post("/v1/contract/esign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createEsignRouteBody.parse(req.body);

    // Build signatories with initial status
    const signatories: SignatoryEntry[] = body.signatories.map((s) => ({
      userId: s.userId,
      ordinal: s.ordinal,
      deadlineDays: s.deadlineDays,
      status: "pending" as const,
      signedAt: null,
    }));

    // Validate signatory constraints
    const validationError = validateSignatories(signatories);
    if (validationError) {
      throw new HttpError(400, "VALIDATION_FAILED", validationError);
    }

    const id = randomUUID();
    const route = await repo.insertEsignRoute({
      id,
      tenantId: ctx.tenantId,
      contractId: body.contractId,
      signatories,
      currentOrdinal: 1,
      status: "in_progress",
      ownerId: body.ownerId,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    });

    return reply.code(201).send({
      data: {
        id: route.id,
        contractId: route.contractId,
        status: route.status,
        currentOrdinal: route.currentOrdinal,
        signatories: route.signatories,
      },
    });
  });

  // ── Sign current signatory ────────────────────────────────────────────
  app.post("/v1/contract/esign/:id/sign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...WRITE_ROLES, ...READ_ROLES]);
    const { id } = esignRouteIdParam.parse(req.params);
    const body = signBody.parse(req.body);

    const route = await repo.getEsignRouteById(id, ctx.tenantId);
    if (!route) {
      throw new HttpError(404, "NOT_FOUND", "e-sign route not found");
    }

    if (route.status !== "in_progress") {
      throw new HttpError(422, "ROUTE_NOT_ACTIVE", `e-sign route is ${route.status}, cannot sign`);
    }

    const signatories = route.signatories as SignatoryEntry[];

    if (!canSign(signatories, route.currentOrdinal, body.userId)) {
      throw new HttpError(422, "CANNOT_SIGN", "user is not the current signatory or has already signed");
    }

    const signedAt = new Date().toISOString();
    const result = applySignature(signatories, route.currentOrdinal, body.userId, signedAt);

    const newStatus = result.isComplete ? "completed" : "in_progress";
    const updated = await repo.updateEsignRoute(id, ctx.tenantId, route.version, {
      signatories: result.signatories,
      currentOrdinal: result.newOrdinal,
      status: newStatus,
      updatedBy: ctx.actorId,
    });

    if (!updated) {
      throw new HttpError(409, "VERSION_CONFLICT", "e-sign route was modified by another request");
    }

    await cache.invalidate(cache.makeKey(ctx.tenantId, "esign_route", id));

    // If not complete, notify next signatory
    if (!result.isComplete) {
      const nextSignatory = result.signatories.find((s) => s.ordinal === result.newOrdinal);
      if (nextSignatory) {
        await queue.publish("notification.send", {
          messageId: randomUUID(),
          type: "notification.send",
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          schemaVersion: "1.0",
          payload: {
            recipient: nextSignatory.userId,
            eventType: "esign_your_turn",
            contractId: route.contractId,
            esignRouteId: id,
            ordinal: nextSignatory.ordinal,
            deadlineDays: nextSignatory.deadlineDays,
          },
        });
      }
    }

    return reply.code(202).send({
      data: {
        id: updated.id,
        status: updated.status,
        currentOrdinal: updated.currentOrdinal,
        signed: true,
        isComplete: result.isComplete,
      },
    });
  });

  // ── Get e-sign route status ───────────────────────────────────────────
  app.get("/v1/contract/esign/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = esignRouteIdParam.parse(req.params);

    const route = await repo.getEsignRouteById(id, ctx.tenantId);
    if (!route) {
      throw new HttpError(404, "NOT_FOUND", "e-sign route not found");
    }

    const signatories = route.signatories as SignatoryEntry[];

    // Compute deadline status for current signatory if route is in progress
    let deadlineStatus: "on_time" | "reminder" | "escalation" | null = null;
    if (route.status === "in_progress") {
      deadlineStatus = checkDeadlineStatus(
        signatories,
        route.currentOrdinal,
        new Date(route.createdAt),
        new Date(),
      );
    }

    return reply.send({
      data: {
        id: route.id,
        contractId: route.contractId,
        status: route.status,
        currentOrdinal: route.currentOrdinal,
        signatories,
        ownerId: route.ownerId,
        deadlineStatus,
        createdAt: route.createdAt,
        updatedAt: route.updatedAt,
        version: route.version,
      },
    });
  });

  // ── Check deadlines (sweep) — internal / cron-triggered ───────────────
  app.post("/v1/contract/esign/:id/check-deadline", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = esignRouteIdParam.parse(req.params);

    const route = await repo.getEsignRouteById(id, ctx.tenantId);
    if (!route) {
      throw new HttpError(404, "NOT_FOUND", "e-sign route not found");
    }

    if (route.status !== "in_progress") {
      return reply.send({ data: { action: "none", reason: "route not in progress" } });
    }

    const signatories = route.signatories as SignatoryEntry[];
    const deadlineStatus = checkDeadlineStatus(
      signatories,
      route.currentOrdinal,
      new Date(route.createdAt),
      new Date(),
    );

    if (deadlineStatus === "reminder") {
      const current = signatories.find((s) => s.ordinal === route.currentOrdinal);
      if (current) {
        await queue.publish("notification.send", {
          messageId: randomUUID(),
          type: "notification.send",
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          schemaVersion: "1.0",
          payload: {
            recipient: current.userId,
            eventType: "esign_deadline_reminder",
            contractId: route.contractId,
            esignRouteId: id,
            ordinal: current.ordinal,
            deadlineDays: current.deadlineDays,
          },
        });
      }
      return reply.send({ data: { action: "reminder_sent", signatoryOrdinal: route.currentOrdinal } });
    }

    if (deadlineStatus === "escalation") {
      // Escalate to contract owner
      await queue.publish("notification.send", {
        messageId: randomUUID(),
        type: "notification.send",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        schemaVersion: "1.0",
        payload: {
          recipient: route.ownerId,
          eventType: "esign_escalation",
          contractId: route.contractId,
          esignRouteId: id,
          currentOrdinal: route.currentOrdinal,
          message: "Signatory has missed the deadline twice. Signing is overdue.",
        },
      });

      // Mark current signatory as overdue
      const updatedSignatories = signatories.map((s) => {
        if (s.ordinal === route.currentOrdinal && s.status === "pending") {
          return { ...s, status: "overdue" as const };
        }
        return s;
      });

      await repo.updateEsignRoute(id, ctx.tenantId, route.version, {
        signatories: updatedSignatories,
        updatedBy: ctx.actorId,
      });

      return reply.send({ data: { action: "escalated", signatoryOrdinal: route.currentOrdinal } });
    }

    return reply.send({ data: { action: "none", reason: "on_time" } });
  });

  // ── Error handler ─────────────────────────────────────────────────────
  app.setErrorHandler((err: unknown, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError || (typeof err === "object" && err !== null && (err as { name?: string }).name === "ZodError")) {
      const zodErr = err as ZodError;
      void reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: zodErr.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    if (err instanceof HttpError) {
      void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
      return;
    }
    req.log.error({ err }, "unhandled error");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
