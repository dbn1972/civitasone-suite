import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { caseIdParam, copyIdParam, requestCopyBody, transitionCopyBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import type { CertifiedCopyRow } from "./schema.js";

// Apply/request a copy: registry-side clerks and admins.
const COPY_WRITE_ROLES  = ["registrar", "court_admin", "court_clerk", "super_admin"];
// Issue / advance / reject a copy: the narrower issuing authority.
const COPY_ISSUE_ROLES  = ["registrar", "court_admin", "super_admin"];
// Read a copy's status (adds judge to the write set).
const COPY_READ_ROLES   = ["registrar", "court_admin", "court_clerk", "super_admin", "judge"];

/**
 * Roles allowed to see the FULL cleartext applicant name. All other read roles
 * receive it REDACTED (null). The name is decrypted only server-side (encryptedText
 * column) and revealed per role — DPDP Act 2023 data minimization (Req 15.3):
 * expose the least PII the caller's role needs.
 */
const PII_PRIVILEGED_ROLES = ["judge", "court_admin", "super_admin"];

/** Serialize a row for the wire: feeMinor as a STRING (BigInt), applicant name masked. */
function serializeCopy(r: CertifiedCopyRow, revealPii: boolean): Record<string, unknown> {
  return {
    id:            r.id,
    caseId:        r.caseId,
    orderId:       r.orderId,
    documentRef:   r.documentRef,
    // PII: decrypted server-side, revealed only to privileged roles, else redacted.
    applicantName: revealPii ? r.applicantNameEnc : null,
    copiesCount:   r.copiesCount,
    urgent:        r.urgent,
    feeMinor:      r.feeMinor.toString(), // BigInt → string (not JSON-serialisable)
    feeSource:     r.feeSource,
    paymentRef:    r.paymentRef,
    receiptMinor:  r.receiptMinor === null ? null : r.receiptMinor.toString(),
    status:        r.status,
    requestedBy:   r.requestedBy,
    issuedBy:      r.issuedBy,
    issuedAt:      r.issuedAt,
    deliveryMode:  r.deliveryMode,
    remarks:       r.remarks,
    version:       r.version,
    createdAt:     r.createdAt,
    updatedAt:     r.updatedAt,
  };
}

export async function certifiedCopyRoutes(app: FastifyInstance): Promise<void> {
  // Apply for a certified copy on a case (§30).
  app.post("/v1/court/cases/:id/certified-copies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COPY_WRITE_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const body = requestCopyBody.parse(req.body);
    const result = await commands.requestCopy(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List a case's certified copies — applicant name masked per role (DPDP minimization).
  app.get("/v1/court/cases/:id/certified-copies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COPY_READ_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const rows = await repo.listCopiesByCase(ctx.tenantId, id);
    const revealPii = hasAnyRole(ctx, PII_PRIVILEGED_ROLES);
    const items = rows.map((r) => serializeCopy(r, revealPii));
    return reply.send({ items, count: items.length, source: "db", piiRevealed: revealPii });
  });

  // Get a single certified copy — applicant name masked per role (DPDP minimization).
  app.get("/v1/court/certified-copies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COPY_READ_ROLES);
    const { id } = copyIdParam.parse(req.params);
    const row = await repo.getCopy(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "COPY_NOT_FOUND", `certified copy ${id} not found`);
    const revealPii = hasAnyRole(ctx, PII_PRIVILEGED_ROLES);
    return reply.send({ item: serializeCopy(row, revealPii), source: "db", piiRevealed: revealPii });
  });

  // Transition a certified copy (advance / issue / reject).
  app.patch("/v1/court/certified-copies/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COPY_ISSUE_ROLES);
    const { id } = copyIdParam.parse(req.params);
    const body = transitionCopyBody.parse(req.body);
    const result = await commands.transitionCopy(ctx, id, body);
    return reply.code(202).send(result);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "certified-copy route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
