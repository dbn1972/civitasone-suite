/**
 * visitor-service: document-scan reads (repo).
 *
 * Read-through via `cache.getOrLoad` for single-session/result lookup.
 * List queries go straight to Postgres (RLS-scoped by tenant_id).
 * Paginated results follow the standard envelope:
 *   `{ data: T[], meta: { page, pageSize, total } }`
 *
 * Requirements validated: 6.1, 6.4, 6.6
 */
import { pino } from "pino";
import { and, eq, count, desc } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { logPiiAccess } from "../dpdp/consent.js";
import {
  scanSessions,
  ocrResults,
  type ScanSessionRow,
  type OcrResultRow,
} from "./schema.js";

const log = pino({ name: "document-scan-repo" });

const RESOURCE_SCAN_SESSION = "scan_session";
const RESOURCE_OCR_RESULT = "ocr_result";

/** Cache TTL: 60s (scan results update during processing). */
const SESSION_TTL = 60;

/**
 * Sentinel accessor id used for Requirement 18.6 PII-access logging when no
 * caller actor context is supplied. Mirrors the `SYSTEM_ACTOR` convention
 * used by dpdp/purge-worker.ts. Real HTTP call sites (routes.ts) pass a
 * `piiCtx` with the actual device/admin actor id; this fallback only fires
 * for callers that omit it.
 */
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

/** Optional actor context for PII access logging (Requirement 18.6). */
export interface PiiAccessContext {
  actorId: string;
  correlationId?: string;
}

// ── Single-entity lookups ─────────────────────────────────────────────────

/**
 * Get a scan session by tenant + session ID.
 * Cache key: `visitor:{tenantId}:scan_session:{sessionId}` (TTL 60s).
 */
export async function getScanSession(tenantId: string, sessionId: string, piiCtx?: PiiAccessContext): Promise<ScanSessionRow | null> {
  const row = await cache.getOrLoad<ScanSessionRow>(
    cache.makeKey(tenantId, RESOURCE_SCAN_SESSION, sessionId),
    async () => {
      // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
      // read — a bare db.select() runs with no RLS GUC set.
      const rows = await scopedRead((tx) =>
        tx
          .select()
          .from(scanSessions)
          .where(and(eq(scanSessions.id, sessionId), eq(scanSessions.tenantId, tenantId)))
          .limit(1),
      );
      return rows[0] ?? null;
    },
    SESSION_TTL,
  );

  // Requirement 18.6: log every read of this scan session, regardless of
  // whether the caller supplied real actor context — best-effort so an
  // audit-log failure never blocks the underlying read (mirrors the Redis
  // revocation-set-sync philosophy in digital-pass/consumer.ts).
  if (row) {
    try {
      await scopedRead((tx) =>
        logPiiAccess(tx, tenantId, piiCtx?.actorId ?? SYSTEM_ACTOR, RESOURCE_SCAN_SESSION, row.id, "detail_view", piiCtx?.correlationId),
      );
    } catch (err) {
      log.warn({ err, tenantId, sessionId, event: "pii_access_log_failed" }, "failed to record PII access log (scan_session)");
    }
  }

  return row;
}

/**
 * Get OCR result by tenant + scan session ID.
 * Cache key: `visitor:{tenantId}:ocr_result:{sessionId}` (TTL 60s).
 */
export async function getOcrResult(tenantId: string, sessionId: string, piiCtx?: PiiAccessContext): Promise<OcrResultRow | null> {
  const row = await cache.getOrLoad<OcrResultRow>(
    cache.makeKey(tenantId, RESOURCE_OCR_RESULT, sessionId),
    async () => {
      // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
      // read — a bare db.select() runs with no RLS GUC set.
      const rows = await scopedRead((tx) =>
        tx
          .select()
          .from(ocrResults)
          .where(and(eq(ocrResults.scanSessionId, sessionId), eq(ocrResults.tenantId, tenantId)))
          .limit(1),
      );
      return rows[0] ?? null;
    },
    SESSION_TTL,
  );

  // Requirement 18.6: this returns the visitor's decrypted fullName,
  // dateOfBirth, idDocumentNumber and address — the most sensitive PII this
  // service handles. Log every read, best-effort (see getScanSession above).
  if (row) {
    try {
      await scopedRead((tx) =>
        logPiiAccess(tx, tenantId, piiCtx?.actorId ?? SYSTEM_ACTOR, RESOURCE_OCR_RESULT, row.id, "detail_view", piiCtx?.correlationId),
      );
    } catch (err) {
      log.warn({ err, tenantId, sessionId, event: "pii_access_log_failed" }, "failed to record PII access log (ocr_result)");
    }
  }

  return row;
}

// ── List queries (paginated) ──────────────────────────────────────────────

export interface ScanListFilters {
  status?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

/**
 * Paginated list of scan sessions for a tenant with optional status filter.
 * Follows the standard response envelope `{ data, meta: { page, pageSize, total } }`.
 */
export async function listScans(
  tenantId: string,
  filters: ScanListFilters = {},
  page = 1,
  pageSize = 20,
): Promise<PaginatedResult<ScanSessionRow>> {
  const conditions = [eq(scanSessions.tenantId, tenantId)];
  if (filters.status) conditions.push(eq(scanSessions.status, filters.status));

  const where = and(...conditions);
  const offset = (page - 1) * pageSize;

  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before these
  // reads — a bare db.select() runs with no RLS GUC set.
  const [data, totalResult] = await scopedRead((tx) =>
    Promise.all([
      tx
        .select()
        .from(scanSessions)
        .where(where)
        .limit(pageSize)
        .offset(offset)
        .orderBy(desc(scanSessions.createdAt)),
      tx
        .select({ total: count() })
        .from(scanSessions)
        .where(where),
    ]),
  );

  const total = totalResult[0]?.total ?? 0;

  return { data, meta: { page, pageSize, total } };
}
