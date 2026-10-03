/**
 * GAP-PAYROLL-TAX-DECLARATION-02: investment-proof upload + verification.
 *
 *   POST /v1/payroll/tax-proofs/presign        employee: signed private upload URL
 *   POST /v1/payroll/tax-proofs                employee: attach the uploaded file (HEAD-verified)
 *   GET  /v1/payroll/tax-proofs/mine           employee: own proofs + per-line summary
 *   DELETE /v1/payroll/tax-proofs/:id          employee: withdraw a still-pending proof
 *   GET  /v1/payroll/tax-proofs                payroll_officer / payroll_admin / auditor: queue
 *   GET  /v1/payroll/tax-proofs/:id/url        short-lived view link (audited first)
 *   POST /v1/payroll/tax-proofs/:id/accept|reject   payroll_officer / payroll_admin (never the owner)
 *   PUT  /v1/payroll/tax-proofs/:id/legal-hold payroll_admin
 *   GET|PUT /v1/payroll/tax-proofs/settings    retention (payroll_admin / tenant_admin / super_admin)
 *
 * Routes only read and publish commands; the consumers write.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { presignedPutUrl, presignedGetUrl, headObject, StorageNotConfiguredError } from "@civitasone/storage";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { requireOwnEmployeeId } from "../../shared/employee-scope.js";
import { resolveActorEmployeeId, HrmsUnavailableError, fetchEmployeeSummaries } from "../../shared/hrms-client.js";
import { scopedRead } from "../../shared/db.js";
import * as commands from "./commands.js";
import { isValidCutoffMd, isValidFy, loadProofSettings, verifiedTdsEnabledFor, DEFAULT_PROOF_CUTOFF_MD, cutoffDate } from "../tax/verified-inputs.js";
import {
  PROOF_LINES, PROOF_CONTENT_TYPES, PROOF_MAX_BYTES, MAX_PROOFS_PER_LINE, PROOF_UPLOAD_TTL_SECONDS, PROOF_VIEW_TTL_SECONDS,
  DEFAULT_RETENTION_YEARS, MIN_RETENTION_YEARS, MAX_RETENTION_YEARS, EMPLOYEE_ROLE, DECIDER_ROLES, VIEWER_ROLES, HOLD_ROLES,
  RETENTION_ROLES, DECLARED_COLUMN, fyStartYear, buildProofKey, contentTypeOfOwnKey, sanitizeFilename,
  type ProofContentType, type ProofLine,
} from "./domain.js";
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => Array.from(r as Iterable<Row>);

const fySchema = z.string().regex(/^\d{4}-\d{2}$/, "fy must be YYYY-YY").refine((v) => fyStartYear(v) !== null, "fy second part must be startYear+1");
const lineSchema = z.enum(PROOF_LINES);
const idParam = z.object({ id: z.string().uuid() });
const amountMinorSchema = z.number().int().nonnegative().max(10_000_000_000_000);

const presignBody = z.object({
  employeeId: z.string().uuid().optional(),
  fy: fySchema,
  line: lineSchema,
  filename: z.string().trim().min(1).max(200),
  contentType: z.string(),
  sizeBytes: z.number().int(),
});

const submitBody = z.object({
  employeeId: z.string().uuid().optional(),
  fy: fySchema,
  line: lineSchema,
  storageKey: z.string().min(1).max(512),
  filename: z.string().trim().min(1).max(200),
  amountMinor: amountMinorSchema.optional(),
});

const rejectBody = z.object({ reason: z.string().trim().min(10).max(500) });
const acceptBody = z.object({ amountMinor: amountMinorSchema.optional() }).default({});
const holdBody = z.object({ hold: z.boolean(), reason: z.string().trim().min(10).max(500) });
const retentionBody = z.object({
  taxProofRetentionYears: z.number().int().min(MIN_RETENTION_YEARS).max(MAX_RETENTION_YEARS).optional(),
  /** "MM-DD" inside the financial year; payroll_admin only. */
  taxProofCutoff: z.string().refine(isValidCutoffMd, "taxProofCutoff must be MM-DD").optional(),
  /** First FY ("2026-27") for which verified-only TDS applies; null switches it off. payroll_admin only. */
  taxProofVerifiedFromFy: z.string().refine(isValidFy, "taxProofVerifiedFromFy must be YYYY-YY").nullable().optional(),
  reason: z.string().trim().min(10).max(500).optional(),
}).refine((b) => b.taxProofRetentionYears !== undefined || b.taxProofCutoff !== undefined || b.taxProofVerifiedFromFy !== undefined, "nothing to change");
const queueQuery = z.object({
  fy: fySchema.optional(),
  status: z.enum(["pending", "accepted", "rejected"]).optional(),
  line: lineSchema.optional(),
  employeeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

/** Never trust an internal service account with employee tax documents. */
function requireViewer(ctx: RequestContext): void {
  requireRole(ctx, [...VIEWER_ROLES]);
  if (ctx.actorType === "service_account") throw new HttpError(403, "FORBIDDEN", "service accounts may not read tax proofs");
}
function requireDecider(ctx: RequestContext): void {
  requireRole(ctx, [...DECIDER_ROLES]);
  if (ctx.actorType === "service_account") throw new HttpError(403, "FORBIDDEN", "service accounts may not verify tax proofs");
}

function storageGuard(err: unknown): never {
  if (err instanceof StorageNotConfiguredError) {
    throw new HttpError(503, "STORAGE_NOT_CONFIGURED", "proof storage is not configured for this environment");
  }
  throw err;
}

/** The caller's own hrms employee id, or null when no employee record is linked. Fails CLOSED on HRMS outage. */
async function ownEmployeeIdOrNull(ctx: RequestContext): Promise<string | null> {
  try {
    return await resolveActorEmployeeId(ctx.tenantId, ctx.actorId);
  } catch (err) {
    if (err instanceof HrmsUnavailableError) throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot resolve caller's employee record");
    throw err;
  }
}

/** Employee-only target: the caller's OWN id; naming anyone else is 403. */
async function ownEmployeeTarget(ctx: RequestContext, requested: string | undefined): Promise<string> {
  requireRole(ctx, [EMPLOYEE_ROLE]);
  const own = await requireOwnEmployeeId(ctx);
  if (requested && requested !== own) throw new HttpError(403, "FORBIDDEN", "employees may only manage their own proofs");
  return own;
}

async function liveCount(tenantId: string, employeeId: string, fy: string, line: string): Promise<number> {
  const r = rowsOf(await scopedRead((tx) => tx.execute(sql`
    SELECT count(*)::int AS n FROM payroll.tax_proofs
     WHERE tenant_id = ${tenantId}::uuid AND employee_id = ${employeeId}::uuid AND fy = ${fy} AND line = ${line} AND status <> 'removed'
  `)));
  return Number(r[0]?.n ?? 0);
}

async function loadProof(tenantId: string, id: string): Promise<Row> {
  const row = rowsOf(await scopedRead((tx) => tx.execute(sql`
    SELECT id::text AS id, employee_id::text AS employee_id, fy, line, storage_key, filename, content_type, status,
           amount_minor::text AS amount_minor, legal_hold, uploaded_by::text AS uploaded_by
      FROM payroll.tax_proofs WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
  `)))[0];
  if (!row) throw new HttpError(404, "NOT_FOUND", "tax proof not found");
  return row;
}

/** Metadata only -- NEVER the storage key. */
function publicProof(r: Row, opts: { staff: boolean }): Record<string, unknown> {
  return {
    id: r.id,
    line: r.line,
    fy: r.fy,
    filename: r.filename,
    contentType: r.content_type,
    sizeBytes: Number(r.size_bytes),
    amountMinor: r.amount_minor === null || r.amount_minor === undefined ? null : String(r.amount_minor),
    status: r.status,
    rejectionReason: r.rejection_reason ?? null,
    createdAt: r.created_at,
    decidedAt: r.decided_at ?? null,
    ...(opts.staff ? { employeeId: r.employee_id, legalHold: Boolean(r.legal_hold), legalHoldReason: r.legal_hold_reason ?? null } : {}),
  };
}

async function retentionYears(tenantId: string): Promise<number> {
  const r = rowsOf(await scopedRead((tx) => tx.execute(sql`
    SELECT tax_proof_retention_years AS years FROM payroll.payroll_settings WHERE tenant_id = ${tenantId}::uuid
  `)))[0];
  return r ? Number(r.years) : DEFAULT_RETENTION_YEARS;
}

export async function taxProofRoutes(app: FastifyInstance): Promise<void> {
  // ── upload: presign ───────────────────────────────────────────────────────
  app.post("/v1/payroll/tax-proofs/presign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [EMPLOYEE_ROLE]);
    const parsed = presignBody.safeParse(req.body ?? {});
    if (!parsed.success) throw parsed.error;
    const b = parsed.data;
    const employeeId = await ownEmployeeTarget(ctx, b.employeeId);
    if (!(b.contentType in PROOF_CONTENT_TYPES)) {
      throw new HttpError(422, "PROOF_TYPE_INVALID", "only PDF, JPEG or PNG files are accepted");
    }
    if (b.sizeBytes <= 0 || b.sizeBytes > PROOF_MAX_BYTES) {
      throw new HttpError(422, "PROOF_TOO_LARGE", `a proof must be between 1 byte and ${PROOF_MAX_BYTES / (1024 * 1024)} MB`);
    }
    if ((await liveCount(ctx.tenantId, employeeId, b.fy, b.line)) >= MAX_PROOFS_PER_LINE) {
      throw new HttpError(409, "PROOF_LIMIT_REACHED", `at most ${MAX_PROOFS_PER_LINE} files per declaration line`);
    }
    const contentType = b.contentType as ProofContentType;
    const key = buildProofKey(ctx.tenantId, b.fy, employeeId, randomUUID(), contentType);
    try {
      const uploadUrl = await presignedPutUrl({
        key, contentType, contentLength: b.sizeBytes, expiresIn: PROOF_UPLOAD_TTL_SECONDS, serverSideEncryption: "AES256",
      });
      return reply.header("Cache-Control", "no-store").send({
        storageKey: key, uploadUrl, expiresInSeconds: PROOF_UPLOAD_TTL_SECONDS, maxBytes: PROOF_MAX_BYTES,
        // The SSE header is part of the signature: the browser MUST send these exactly.
        headers: { "content-type": contentType, "x-amz-server-side-encryption": "AES256" },
      });
    } catch (err) {
      return storageGuard(err);
    }
  });

  // ── upload: attach (HEAD-verified) ────────────────────────────────────────
  app.post("/v1/payroll/tax-proofs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [EMPLOYEE_ROLE]);
    const parsed = submitBody.safeParse(req.body ?? {});
    if (!parsed.success) throw parsed.error;
    const b = parsed.data;
    const employeeId = await ownEmployeeTarget(ctx, b.employeeId);

    // A foreign / forged / malformed key is refused before anything touches storage.
    const implied = contentTypeOfOwnKey(b.storageKey, ctx.tenantId, b.fy, employeeId);
    if (!implied) throw new HttpError(422, "INVALID_STORAGE_KEY", "storageKey was not issued to you for this financial year");

    const head = await headObject(b.storageKey);
    if (!head) throw new HttpError(422, "PROOF_FILE_MISSING", "the uploaded file was not found; upload it again");
    if (head.contentLength === null || head.contentLength <= 0 || head.contentLength > PROOF_MAX_BYTES) {
      throw new HttpError(422, "PROOF_TOO_LARGE", `a proof must be between 1 byte and ${PROOF_MAX_BYTES / (1024 * 1024)} MB`);
    }
    if (head.contentType !== implied) {
      throw new HttpError(422, "PROOF_TYPE_INVALID", "the uploaded file is not a PDF, JPEG or PNG matching its declared type");
    }
    if ((await liveCount(ctx.tenantId, employeeId, b.fy, b.line)) >= MAX_PROOFS_PER_LINE) {
      throw new HttpError(409, "PROOF_LIMIT_REACHED", `at most ${MAX_PROOFS_PER_LINE} files per declaration line`);
    }
    const accepted = await commands.submitProof(ctx, {
      employeeId, fy: b.fy, line: b.line as ProofLine, storageKey: b.storageKey, filename: sanitizeFilename(b.filename),
      contentType: implied, sizeBytes: head.contentLength, amountMinor: b.amountMinor,
    });
    return sendAccepted(reply, acceptedResponseSchema, accepted);
  });

  // ── employee: own proofs + per-line summary ───────────────────────────────
  app.get("/v1/payroll/tax-proofs/mine", async (req, reply) => {
    const ctx = resolveContext(req);
    const { fy } = z.object({ fy: fySchema }).parse(req.query);
    const employeeId = await ownEmployeeTarget(ctx, undefined);
    const proofSettings = await scopedRead((tx) => loadProofSettings(tx, ctx.tenantId));
    const { items, declared } = await scopedRead(async (tx) => ({
      items: rowsOf(await tx.execute(sql`
        SELECT id::text AS id, employee_id::text AS employee_id, fy, line, filename, content_type, size_bytes, amount_minor::text AS amount_minor,
               status, rejection_reason, legal_hold, legal_hold_reason, created_at, decided_at
          FROM payroll.tax_proofs
         WHERE tenant_id = ${ctx.tenantId}::uuid AND employee_id = ${employeeId}::uuid AND fy = ${fy} AND status <> 'removed'
         ORDER BY line, created_at, id
      `)),
      declared: rowsOf(await tx.execute(sql`
        SELECT section_80c::text AS section_80c, section_80d::text AS section_80d, rent_paid_minor::text AS rent_paid_minor,
               other_deductions::text AS other_deductions
          FROM payroll.payroll_tax_declarations
         WHERE tenant_id = ${ctx.tenantId}::uuid AND employee_id = ${employeeId}::uuid AND fy = ${fy} LIMIT 1
      `))[0] ?? null,
    }));
    const summary = PROOF_LINES.map((line) => {
      const mine = items.filter((i) => i.line === line);
      const col = DECLARED_COLUMN[line];
      const verified = mine.filter((i) => i.status === "accepted").reduce((a, i) => a + BigInt(String(i.amount_minor ?? "0")), 0n);
      return {
        line,
        total: mine.length,
        pending: mine.filter((i) => i.status === "pending").length,
        accepted: mine.filter((i) => i.status === "accepted").length,
        rejected: mine.filter((i) => i.status === "rejected").length,
        maxFiles: MAX_PROOFS_PER_LINE,
        declaredMinor: col && declared ? String(declared[col]) : null,
        verifiedMinor: verified.toString(),
      };
    });
    return reply.header("Cache-Control", "no-store").send({
      fy, items: items.map((r) => publicProof(r, { staff: false })), summary,
      // Only when the tenant opted in: the date after which only accepted documents count for TDS.
      verifiedTdsEnabled: verifiedTdsEnabledFor(proofSettings, fy),
      cutoffDate: verifiedTdsEnabledFor(proofSettings, fy) ? cutoffDate(fy, proofSettings.cutoffMd) : null,
      limits: { maxFiles: MAX_PROOFS_PER_LINE, maxBytes: PROOF_MAX_BYTES, contentTypes: Object.keys(PROOF_CONTENT_TYPES) },
    });
  });

  // ── employee: withdraw a still-pending proof ──────────────────────────────
  app.delete("/v1/payroll/tax-proofs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [EMPLOYEE_ROLE]);
    const { id } = idParam.parse(req.params);
    const employeeId = await ownEmployeeTarget(ctx, undefined);
    const proof = await loadProof(ctx.tenantId, id);
    if (proof.employee_id !== employeeId) throw new HttpError(404, "NOT_FOUND", "tax proof not found");
    if (proof.status !== "pending") throw new HttpError(409, "INVALID_STATE", `proof is ${String(proof.status)}; only a pending proof can be removed`);
    if (proof.legal_hold) throw new HttpError(409, "LEGAL_HOLD", "this proof is under legal hold and cannot be removed");
    return sendAccepted(reply, acceptedResponseSchema, await commands.removeProof(ctx, id, employeeId));
  });

  // ── payroll queue (list: counts + metadata only) ──────────────────────────
  app.get("/v1/payroll/tax-proofs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireViewer(ctx);
    const q = queueQuery.parse(req.query);
    const where = sql`tenant_id = ${ctx.tenantId}::uuid AND status <> 'removed'
      ${q.fy ? sql`AND fy = ${q.fy}` : sql``}
      ${q.status ? sql`AND status = ${q.status}` : sql``}
      ${q.line ? sql`AND line = ${q.line}` : sql``}
      ${q.employeeId ? sql`AND employee_id = ${q.employeeId}::uuid` : sql``}`;
    const { items, counts } = await scopedRead(async (tx) => ({
      items: rowsOf(await tx.execute(sql`
        SELECT id::text AS id, employee_id::text AS employee_id, fy, line, filename, content_type, size_bytes, amount_minor::text AS amount_minor,
               status, rejection_reason, legal_hold, legal_hold_reason, created_at, decided_at
          FROM payroll.tax_proofs WHERE ${where}
         ORDER BY created_at DESC, id LIMIT ${q.limit} OFFSET ${q.offset}
      `)),
      counts: rowsOf(await tx.execute(sql`
        SELECT status, count(*)::int AS n FROM payroll.tax_proofs WHERE ${where} GROUP BY status
      `)),
    }));
    const byStatus = { pending: 0, accepted: 0, rejected: 0 } as Record<string, number>;
    for (const c of counts) byStatus[String(c.status)] = Number(c.n);
    const names = items.length > 0 ? await fetchEmployeeSummaries(ctx.tenantId) : new Map();
    const data = items.map((r) => {
      const who = names.get(String(r.employee_id));
      return { ...publicProof(r, { staff: true }), employeeName: who?.fullName ?? null, employeeNo: who?.employeeNo ?? null };
    });
    return reply.header("Cache-Control", "no-store").send({
      data, meta: { total: byStatus.pending! + byStatus.accepted! + byStatus.rejected!, limit: q.limit, offset: q.offset, counts: byStatus },
    });
  });

  // ── short-lived view link, audited BEFORE it is returned ──────────────────
  app.get("/v1/payroll/tax-proofs/:id/url", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = idParam.parse(req.params);
    const isViewer = [...VIEWER_ROLES].some((r) => ctx.roles.includes(r)) && ctx.actorType !== "service_account";
    if (!isViewer && !ctx.roles.includes(EMPLOYEE_ROLE)) {
      throw new HttpError(403, "FORBIDDEN", `requires one of: ${[...VIEWER_ROLES, EMPLOYEE_ROLE].join(", ")}`);
    }
    const proof = await loadProof(ctx.tenantId, id);
    if (!isViewer) {
      // Self-service: own proofs only. Someone else's proof looks like it does not exist.
      const own = await requireOwnEmployeeId(ctx);
      if (proof.employee_id !== own) throw new HttpError(404, "NOT_FOUND", "tax proof not found");
    }
    if (proof.status === "removed") throw new HttpError(404, "NOT_FOUND", "tax proof not found");
    // Audit first: if the audit event cannot be queued, no link is issued.
    await commands.recordProofView(ctx, id, {
      fy: proof.fy, line: proof.line, employeeId: proof.employee_id, viewerKind: isViewer ? "staff" : "owner", ttlSeconds: PROOF_VIEW_TTL_SECONDS,
    });
    try {
      const url = await presignedGetUrl({ key: String(proof.storage_key), expiresIn: PROOF_VIEW_TTL_SECONDS });
      return reply.header("Cache-Control", "no-store").send({ url, expiresInSeconds: PROOF_VIEW_TTL_SECONDS, filename: proof.filename, contentType: proof.content_type });
    } catch (err) {
      return storageGuard(err);
    }
  });

  // ── verification: accept / reject (maker != checker) ──────────────────────
  const decide = (decision: "accepted" | "rejected") => async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    const ctx = resolveContext(req);
    requireDecider(ctx);
    const { id } = idParam.parse(req.params);
    const body = decision === "rejected" ? rejectBody.parse(req.body ?? {}) : acceptBody.parse(req.body ?? {});
    const proof = await loadProof(ctx.tenantId, id);
    const own = await ownEmployeeIdOrNull(ctx);
    if ((own !== null && own === proof.employee_id) || proof.uploaded_by === ctx.actorId) {
      throw new HttpError(403, "SELF_VERIFY_FORBIDDEN", "a proof must be verified by someone other than its owner");
    }
    if (proof.status !== "pending") throw new HttpError(409, "INVALID_STATE", `proof is ${String(proof.status)}; only a pending proof can be verified`);
    // Accepting verifies an AMOUNT: a proof with no stored amount needs the officer's.
    if (decision === "accepted" && proof.amount_minor === null && !("amountMinor" in body && body.amountMinor !== undefined)) {
      throw new HttpError(422, "AMOUNT_REQUIRED", "enter the amount shown on the document to accept it");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.decideProof(ctx, id, {
      decision,
      reason: "reason" in body ? body.reason : undefined,
      amountMinor: "amountMinor" in body ? body.amountMinor : undefined,
      deciderEmployeeId: own,
    }));
  };
  app.post("/v1/payroll/tax-proofs/:id/accept", decide("accepted"));
  app.post("/v1/payroll/tax-proofs/:id/reject", decide("rejected"));

  // ── legal hold ────────────────────────────────────────────────────────────
  app.put("/v1/payroll/tax-proofs/:id/legal-hold", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HOLD_ROLES]);
    if (ctx.actorType === "service_account") throw new HttpError(403, "FORBIDDEN", "service accounts may not set legal holds");
    const { id } = idParam.parse(req.params);
    const b = holdBody.parse(req.body ?? {});
    await loadProof(ctx.tenantId, id);
    return sendAccepted(reply, acceptedResponseSchema, await commands.setLegalHold(ctx, id, b.hold, b.reason));
  });

  // ── retention setting ─────────────────────────────────────────────────────
  app.get("/v1/payroll/tax-proofs/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...new Set([...VIEWER_ROLES, ...RETENTION_ROLES])]);
    const proofSettings = await scopedRead((tx) => loadProofSettings(tx, ctx.tenantId));
    const cutoffMd = proofSettings.cutoffMd;
    const currentFy = (() => {
      const now = new Date(Date.now() + 330 * 60_000);
      const start = now.getUTCMonth() + 1 >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
      return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
    })();
    return reply.header("Cache-Control", "no-store").send({
      taxProofCutoff: cutoffMd,
      taxProofVerifiedFromFy: proofSettings.verifiedFromFy,
      canEditVerifiedFrom: [...HOLD_ROLES].some((r) => ctx.roles.includes(r)),
      defaultCutoff: DEFAULT_PROOF_CUTOFF_MD,
      currentFyCutoffDate: cutoffDate(currentFy, cutoffMd),
      canEditCutoff: [...HOLD_ROLES].some((r) => ctx.roles.includes(r)),
      taxProofRetentionYears: await retentionYears(ctx.tenantId),
      defaultYears: DEFAULT_RETENTION_YEARS, minYears: MIN_RETENTION_YEARS, maxYears: MAX_RETENTION_YEARS,
      canEdit: [...RETENTION_ROLES].some((r) => ctx.roles.includes(r)),
      canHold: [...HOLD_ROLES].some((r) => ctx.roles.includes(r)),
    });
  });

  app.put("/v1/payroll/tax-proofs/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...RETENTION_ROLES]);
    const b = retentionBody.parse(req.body ?? {});
    // The cutoff and the verified-TDS opt-in change TDS, so only payroll_admin may move them.
    if (b.taxProofCutoff !== undefined || b.taxProofVerifiedFromFy !== undefined) requireRole(ctx, ["payroll_admin"]);
    const applied: Array<{ field: string; commandId: string }> = [];
    let last: commands.Accepted | null = null;
    if (b.taxProofRetentionYears !== undefined) {
      last = await commands.setRetentionYears(ctx, b.taxProofRetentionYears, b.reason);
      applied.push({ field: "taxProofRetentionYears", commandId: last.id });
    }
    if (b.taxProofCutoff !== undefined) {
      last = await commands.setProofCutoff(ctx, b.taxProofCutoff, b.reason);
      applied.push({ field: "taxProofCutoff", commandId: last.id });
    }
    if (b.taxProofVerifiedFromFy !== undefined) {
      last = await commands.setVerifiedFromFy(ctx, b.taxProofVerifiedFromFy, b.reason);
      applied.push({ field: "taxProofVerifiedFromFy", commandId: last.id });
    }
    // One acknowledgement covering every field that was sent (not just the last).
    return sendAccepted(reply, acceptedResponseSchema, { ...last!, data: { id: last!.id, applied } });
  });
}
