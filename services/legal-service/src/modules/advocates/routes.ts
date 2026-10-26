/**
 * GAP-LEGAL-LIST-04 (owner decision #14): empanelled-advocate master.
 *   POST /v1/legal/advocates   legal head only (legal_admin / super_admin), CQRS 202
 *   GET  /v1/legal/advocates   legal + audit readers; contact masked except for the legal head
 */
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { hasAnyRole } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createAdvocateBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ADMIN_ROLES = ["legal_admin", "super_admin"];
const READER_ROLES = ["legal_officer", ...ADMIN_ROLES, "audit_officer"];

/** Phone: only the last two digits are shown. Email: first character and the domain. */
export function maskContact(contact: string): string {
  if (contact.includes("@")) {
    const [local = "", domain = ""] = contact.split("@");
    return `${local.slice(0, 1)}•••@${domain}`;
  }
  const digits = contact.replace(/\D/g, "");
  return `${"•".repeat(Math.max(0, digits.length - 2))}${digits.slice(-2)}`;
}

export async function advocateRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/legal/advocates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createAdvocateBody.parse(req.body);
    if (await repo.findAdvocateByBarNo(ctx.tenantId, body.barEnrolmentNo)) {
      throw new HttpError(409, "DUPLICATE_BAR_ENROLMENT", "an advocate with this Bar enrolment number is already empanelled");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAdvocate(ctx, body));
  });

  app.get("/v1/legal/advocates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const full = hasAnyRole(ctx, ADMIN_ROLES);
    const rows = await repo.listAdvocates(ctx.tenantId);
    return reply.send({
      items: rows.map((r) => ({ id: r.id, name: r.name, barEnrolmentNo: r.barEnrolmentNo, contact: full ? r.contact : maskContact(r.contact) })),
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
