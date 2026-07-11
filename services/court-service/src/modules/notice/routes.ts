import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  caseIdParam, noticeIdParam,
  issueNoticeBody, recordServiceBody, updateNoticeStatusBody,
} from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const NOTICE_WRITE_ROLES = ["registrar", "court_admin", "bailiff", "super_admin"];
const NOTICE_READ_ROLES = ["registrar", "court_admin", "bailiff", "court_clerk", "judge", "super_admin"];

/**
 * Roles allowed to see cleartext addressee PII (issued_to / recipient / proof).
 * All other read roles receive it REDACTED to null. rendered_body stays visible
 * to every court read role — it is the official served-notice record (§21).
 * DPDP Act 2023 data minimization (Req 15.3): expose the least PII the role needs.
 */
const PII_PRIVILEGED_ROLES = ["judge", "court_admin", "super_admin"];

export async function noticeRoutes(app: FastifyInstance): Promise<void> {
  // Issue a notice on a case.
  app.post("/v1/court/cases/:id/notices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, NOTICE_WRITE_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const body = issueNoticeBody.parse(req.body);
    const result = await commands.issueNotice(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List a case's notices.
  app.get("/v1/court/cases/:id/notices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, NOTICE_READ_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const rows = await repo.listNoticesByCase(ctx.tenantId, id);
    const privileged = hasAnyRole(ctx, PII_PRIVILEGED_ROLES);
    const items = rows.map((r) => ({
      id:           r.id,
      caseId:       r.caseId,
      noticeType:   r.noticeType,
      status:       r.status,
      issueDate:    r.issueDate,
      renderedBody: r.renderedBody,        // official served-notice record — all court read roles
      version:      r.version,
      createdAt:    r.createdAt,
      updatedAt:    r.updatedAt,
      // Addressee PII (decrypted server-side) — REDACTED for non-privileged read roles.
      issuedTo:     privileged ? r.issuedTo : null,
    }));
    return reply.send({ items, count: items.length, source: "db", piiRevealed: privileged });
  });

  // Record a service attempt against a notice.
  app.post("/v1/court/notices/:id/service", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, NOTICE_WRITE_ROLES);
    const { id } = noticeIdParam.parse(req.params);
    const body = recordServiceBody.parse(req.body);
    const result = await commands.recordService(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List a notice's service attempts.
  app.get("/v1/court/notices/:id/service", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, NOTICE_READ_ROLES);
    const { id } = noticeIdParam.parse(req.params);
    const rows = await repo.listServiceByNotice(ctx.tenantId, id);
    const privileged = hasAnyRole(ctx, PII_PRIVILEGED_ROLES);
    const items = rows.map((r) => ({
      id:             r.id,
      noticeId:       r.noticeId,
      serviceMode:    r.serviceMode,
      dispatchRef:    r.dispatchRef,
      deliveryStatus: r.deliveryStatus,
      servedAt:       r.servedAt,
      version:        r.version,
      createdAt:      r.createdAt,
      updatedAt:      r.updatedAt,
      // recipient + proof may embed personal data — REDACTED for non-privileged read roles.
      recipient:      privileged ? r.recipient : null,
      proof:          privileged ? r.proof : null,
    }));
    return reply.send({ items, count: items.length, source: "db", piiRevealed: privileged });
  });

  // Update a notice's lifecycle status.
  app.patch("/v1/court/notices/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, NOTICE_WRITE_ROLES);
    const { id } = noticeIdParam.parse(req.params);
    const body = updateNoticeStatusBody.parse(req.body);
    const result = await commands.updateNoticeStatus(ctx, id, body);
    return reply.code(202).send(result);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "notice route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
