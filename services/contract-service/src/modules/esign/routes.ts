import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createEsignRouteBody, esignRouteIdParam, signBody } from "./validators.js";
import { validateSignatories, canSign, checkDeadlineStatus } from "./domain.js";
import type { SignatoryEntry } from "./schema.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import { queue } from "../../shared/infra.js";

const WRITE_ROLES = ["procurement_admin", "finance_admin", "super_admin", "legal_officer", "contract_admin"];
const READ_ROLES = [...WRITE_ROLES, "audit_officer", "procurement_officer", "finance_officer"];

export async function esignRoutes(app: FastifyInstance): Promise<void> {
  // ── Create e-sign routing — queue-first CQRS write ────────────────────
  app.post("/v1/contract/esign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createEsignRouteBody.parse(req.body);

    // Build signatories with initial status (for pre-publish validation only)
    const signatories: SignatoryEntry[] = body.signatories.map((s) => ({
      userId: s.userId,
      ordinal: s.ordinal,
      deadlineDays: s.deadlineDays,
      status: "pending" as const,
      signedAt: null,
    }));

    // Validate signatory constraints (pre-publish, read-only)
    const validationError = validateSignatories(signatories);
    if (validationError) {
      throw new HttpError(400, "VALIDATION_FAILED", validationError);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.createEsignRoute(ctx, body));
  });

  // ── Sign current signatory — queue-first CQRS write ───────────────────
  app.post("/v1/contract/esign/:id/sign", async (req, reply) => {
    const ctx = resolveContext(req);
    // [...WRITE_ROLES, ...READ_ROLES] was a no-op union (READ_ROLES already
    // contains every WRITE_ROLES entry) — collapsed to READ_ROLES for clarity.
    // Note: this is deliberately a coarse "may this actor touch e-sign at all"
    // gate, not the real authorization check. The real check is `canSign`
    // below, which is now bound to the AUTHENTICATED caller (ctx.actorId).
    requireRole(ctx, READ_ROLES);
    const { id } = esignRouteIdParam.parse(req.params);
    // SEC: signBody intentionally carries no fields. The signer is always
    // ctx.actorId — see the note on signBody in validators.ts. This parse
    // call is kept only as defensive validation that the body (if any) is a
    // JSON object; its result is not used.
    signBody.parse(req.body ?? {});

    const route = await repo.getEsignRouteById(id, ctx.tenantId);
    if (!route) {
      throw new HttpError(404, "NOT_FOUND", "e-sign route not found");
    }

    if (route.status !== "in_progress") {
      throw new HttpError(422, "ROUTE_NOT_ACTIVE", `e-sign route is ${route.status}, cannot sign`);
    }

    const signatories = route.signatories as SignatoryEntry[];

    if (!canSign(signatories, route.currentOrdinal, ctx.actorId)) {
      throw new HttpError(422, "CANNOT_SIGN", "user is not the current signatory or has already signed");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.signEsignRoute(ctx, id));
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
  // Read-only decision here; the actual escalation write (marking the
  // signatory overdue + emitting contract.esign.escalated) is queue-first
  // via COMMANDS.esignCheckDeadline (see consumer.ts).
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

      // Mark current signatory as overdue — queue-first (no direct repo write here)
      await commands.checkEsignDeadline(ctx, id);

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
