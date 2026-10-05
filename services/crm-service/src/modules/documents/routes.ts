/**
 * DM-001/002 — Document & Attachment Management (BRD §7.12) HTTP surface.
 *
 *   POST   /v1/crm/documents/presign            — mint a REAL presigned PUT URL + key
 *   POST   /v1/crm/documents                      — confirm upload → metadata (202, CQRS)
 *   GET    /v1/crm/documents?subjectType&subjectId — access-controlled list
 *   GET    /v1/crm/documents/:id/download          — presigned GET (403 if infected)
 *   DELETE /v1/crm/documents/:id                    — soft-delete (202, CQRS)
 *   POST   /v1/crm/documents/:id/verify             — DM-002 verify/reject (202, CQRS)
 *   POST   /v1/crm/documents/:id/scan-result        — internal scanner callback (202, CQRS)
 *
 * All reads/writes are tenant + subject scoped and role-gated. Files live in S3;
 * only metadata lives here (DM-003 storage_provider records the external home).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import * as commands from "./commands.js";
import {
  presignBody,
  confirmBody,
  listQuery,
  verifyBody,
  scanResultBody,
  idParam,
  registerQuery,
} from "./validators.js";
import {
  buildStorageKey,
  tenantPrefix,
  presignedPutUrl,
  presignedGetUrl,
  objectExists,
  PUT_URL_TTL_SECONDS,
  GET_URL_TTL_SECONDS,
} from "./storage.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

const SELECT_COLS = sql`
  id, subject_type AS "subjectType", subject_id AS "subjectId", doc_type AS "docType",
  title, filename, storage_key AS "storageKey", storage_provider AS "storageProvider",
  mime_type AS "mimeType", size_bytes AS "sizeBytes", checksum, lineage_id AS "lineageId",
  version, is_current AS "isCurrent", scan_status AS "scanStatus",
  verification_status AS "verificationStatus", verified_by AS "verifiedBy",
  verified_at AS "verifiedAt", expiry_date AS "expiryDate", uploaded_by AS "uploadedBy",
  created_at AS "createdAt"`;

async function findDocument(tenantId: string, id: string): Promise<Record<string, unknown> | undefined> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT ${SELECT_COLS} FROM crm.documents
    WHERE id = ${id} AND tenant_id = ${tenantId} AND deleted_at IS NULL
  `))) as unknown as Array<Record<string, unknown>>;
  return rows[0];
}

/** Confirm-time existence check is on by default; a dev/test flag can disable it. */
function requireObjectOnConfirm(): boolean {
  return process.env.CRM_CONFIRM_REQUIRE_OBJECT !== "0";
}

/**
 * Malware-scan gating is SECURE-BY-DEFAULT: only `scan_status='clean'` is
 * downloadable; pending/infected/error all refuse. Since scan-gated access IS the
 * DM-001 acceptance criterion, a still-unscanned (pending) file must NOT be handed
 * out by default.
 *
 * Honest consequence: in an environment with no live scanner wired, documents stay
 * 'pending' forever, so downloads await a scan verdict — which is the correct
 * tradeoff for a scan-gated feature (the FE mirrors this by only offering download
 * for 'clean'). An operator who consciously accepts serving unscanned files (e.g. a
 * no-scanner deployment) can opt OUT with CRM_ALLOW_PENDING_DOWNLOADS='true'; that
 * relaxes ONLY the pending case — infected/error stay blocked unconditionally.
 */
function allowPendingDownloads(): boolean {
  return process.env.CRM_ALLOW_PENDING_DOWNLOADS === "true";
}

function isInternalCall(req: FastifyRequest): boolean {
  return req.headers["x-internal"] === "1";
}

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  // ── presign: mint a real SigV4 PUT URL + the key the client must upload to ──
  app.post("/v1/crm/documents/presign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const b = presignBody.parse(req.body);
    const storageKey = buildStorageKey(ctx.tenantId, b.subjectType, b.subjectId, b.filename);
    const uploadUrl = await presignedPutUrl({
      key: storageKey,
      contentType: b.mimeType,
      expiresIn: PUT_URL_TTL_SECONDS,
    });
    return reply.send({ data: { storageKey, uploadUrl, expiresIn: PUT_URL_TTL_SECONDS } });
  });

  // ── confirm: verify object landed, then create metadata (scan_status=pending) ──
  app.post("/v1/crm/documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const b = confirmBody.parse(req.body);

    // The key must live under THIS tenant's prefix — a client cannot confirm a row
    // pointing at another tenant's object.
    if (!b.storageKey.startsWith(tenantPrefix(ctx.tenantId))) {
      throw new HttpError(400, "INVALID_STORAGE_KEY", "storageKey is not in this tenant's namespace");
    }

    if (requireObjectOnConfirm() && !(await objectExists(b.storageKey))) {
      throw new HttpError(422, "OBJECT_NOT_FOUND", "no uploaded object at storageKey");
    }

    // If superseding, the prior document must exist for this tenant + same subject.
    if (b.supersedesId) {
      const prior = await findDocument(ctx.tenantId, b.supersedesId);
      if (!prior) throw new HttpError(404, "NOT_FOUND", "supersedesId not found");
      if (prior.subjectType !== b.subjectType || prior.subjectId !== b.subjectId) {
        throw new HttpError(400, "SUBJECT_MISMATCH", "supersedesId belongs to a different subject");
      }
    }

    const id = randomUUID();
    return sendAccepted(reply, acceptedResponseSchema, await commands.confirmDocument(ctx, id, b));
  });

  // ── list: access-controlled, tenant + subject scoped ──
  app.get("/v1/crm/documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listQuery.parse(req.query);
    const currentFilter = q.includeSuperseded ? sql`` : sql`AND is_current = true`;
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT ${SELECT_COLS} FROM crm.documents
      WHERE tenant_id = ${ctx.tenantId} AND subject_type = ${q.subjectType}
        AND subject_id = ${q.subjectId} AND deleted_at IS NULL ${currentFilter}
      ORDER BY lineage_id, version DESC
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  // ── GAP-CRM-DOCUMENTS-02: cross-record register (paged, tenant-scoped) ──
  //
  // Unlike the per-subject list above, this spans every record so a clerk can
  // triage expiring / infected / missing-mandatory documents in one place. It
  // returns the subject TYPE + ID only (never a cross-module join to resolve the
  // record's name — the web layer resolves names the same way other screens do).
  //
  // `missingMandatory` is a different shape of answer: it reports (subjectType,
  // subjectId, docTypeCode) tuples that LACK a current mandatory document, so its
  // rows carry no document id. To avoid a cross-module join (we cannot enumerate
  // every lead/contact/account from here), the universe of subjects scanned is
  // those that already own at least one document — an honest, documented scope.
  app.get("/v1/crm/documents/register", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = registerQuery.parse(req.query ?? {});
    const limit = q.limit;
    const offset = (q.page - 1) * limit;
    const subjectFilter = q.subjectType ? sql`AND subject_type = ${q.subjectType}` : sql``;

    if (q.missingMandatory) {
      // Subjects (that own ≥1 document) missing a current doc of a mandatory type
      // that applies to their subject_type. appliesTo=[] (wildcard) applies to all.
      const base = sql`
        WITH subjects AS (
          SELECT DISTINCT subject_type, subject_id FROM crm.documents
          WHERE tenant_id = ${ctx.tenantId} AND deleted_at IS NULL ${subjectFilter}
        ),
        required AS (
          SELECT s.subject_type, s.subject_id, dt.code AS doc_type_code, dt.name AS doc_type_name
          FROM subjects s
          JOIN crm.document_types dt
            ON dt.tenant_id = ${ctx.tenantId} AND dt.enabled = true AND dt.mandatory = true
           AND (cardinality(dt.applies_to) = 0 OR s.subject_type = ANY (dt.applies_to))
        ),
        missing AS (
          SELECT r.subject_type, r.subject_id, r.doc_type_code, r.doc_type_name
          FROM required r
          WHERE NOT EXISTS (
            SELECT 1 FROM crm.documents d
            WHERE d.tenant_id = ${ctx.tenantId} AND d.subject_type = r.subject_type
              AND d.subject_id = r.subject_id AND d.doc_type = r.doc_type_code
              AND d.is_current = true AND d.deleted_at IS NULL
          )
        )`;
      const totalRows = (await scopedRead((tx) => tx.execute(sql`
        ${base} SELECT count(*)::int AS total FROM missing
      `))) as unknown as Array<{ total: number }>;
      const rows = (await scopedRead((tx) => tx.execute(sql`
        ${base}
        SELECT subject_type AS "subjectType", subject_id AS "subjectId",
               doc_type_code AS "docTypeCode", doc_type_name AS "docTypeName"
        FROM missing
        ORDER BY subject_type, subject_id, doc_type_code
        LIMIT ${limit} OFFSET ${offset}
      `))) as unknown as Array<Record<string, unknown>>;
      const data = rows.map((r) => ({ ...r, kind: "missing_mandatory" as const }));
      return reply.send({ data, meta: { total: totalRows[0]?.total ?? 0, page: q.page, pageSize: limit } });
    }

    // Document-row register (optionally scan-status and/or expiry filtered).
    const scanFilter = q.scanStatus ? sql`AND scan_status = ${q.scanStatus}` : sql``;
    const expiryFilter =
      q.expiringWithinDays !== undefined
        ? sql`AND expiry_date IS NOT NULL AND expiry_date <= (CURRENT_DATE + ${q.expiringWithinDays} * INTERVAL '1 day')`
        : sql``;
    const where = sql`
      WHERE tenant_id = ${ctx.tenantId} AND deleted_at IS NULL AND is_current = true
        ${subjectFilter} ${scanFilter} ${expiryFilter}`;
    const totalRows = (await scopedRead((tx) => tx.execute(sql`
      SELECT count(*)::int AS total FROM crm.documents ${where}
    `))) as unknown as Array<{ total: number }>;
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, subject_type AS "subjectType", subject_id AS "subjectId",
             doc_type AS "docType", title, filename, scan_status AS "scanStatus",
             verification_status AS "verificationStatus", expiry_date AS "expiryDate",
             version, created_at AS "createdAt"
      FROM crm.documents ${where}
      ORDER BY (expiry_date IS NULL), expiry_date ASC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `))) as unknown as Array<Record<string, unknown>>;
    const data = rows.map((r) => ({ ...r, kind: "document" as const }));
    return reply.send({ data, meta: { total: totalRows[0]?.total ?? 0, page: q.page, pageSize: limit } });
  });

  // ── download: presigned GET, scan-gated SECURE-BY-DEFAULT (only 'clean' passes) ──
  app.get("/v1/crm/documents/:id/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const doc = await findDocument(ctx.tenantId, id);
    if (!doc) throw new HttpError(404, "NOT_FOUND", "document not found");

    const scan = doc.scanStatus as string;
    if (scan === "infected") {
      throw new HttpError(403, "SCAN_INFECTED", "download blocked: file failed malware scan");
    }
    if (scan === "error") {
      throw new HttpError(403, "SCAN_ERROR", "download blocked: malware scan could not complete");
    }
    // Default-deny: a pending (unscanned) file is withheld until a verdict arrives,
    // unless an operator has explicitly opted OUT via CRM_ALLOW_PENDING_DOWNLOADS.
    if (scan === "pending" && !allowPendingDownloads()) {
      throw new HttpError(409, "SCAN_PENDING", "download withheld until malware scan completes");
    }

    const downloadUrl = await presignedGetUrl({
      key: doc.storageKey as string,
      expiresIn: GET_URL_TTL_SECONDS,
    });
    return reply.send({ data: { downloadUrl, expiresIn: GET_URL_TTL_SECONDS, scanStatus: scan } });
  });

  // ── delete: soft-delete (S3 object retained by policy) ──
  app.delete("/v1/crm/documents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    if (!(await findDocument(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "document not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteDocument(ctx, id));
  });

  // ── DM-002 verify / reject ──
  app.post("/v1/crm/documents/:id/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const b = verifyBody.parse(req.body);
    if (!(await findDocument(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "document not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.verifyDocument(ctx, id, b));
  });

  // ── internal scanner callback (service-secret gated by authPlugin x-internal) ──
  app.post("/v1/crm/documents/:id/scan-result", async (req, reply) => {
    const ctx = resolveContext(req);
    // Belt-and-braces: the authPlugin already validated the service secret for any
    // x-internal call; refuse anything that is not an internal service caller.
    if (!isInternalCall(req)) {
      throw new HttpError(403, "FORBIDDEN", "scan-result is an internal service endpoint");
    }
    requireRole(ctx, ["super_admin"]);
    const { id } = idParam.parse(req.params);
    const b = scanResultBody.parse(req.body);
    if (!(await findDocument(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "document not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordDocumentScan(ctx, id, b));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
