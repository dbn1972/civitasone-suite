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
import { and, eq, count, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import {
  scanSessions,
  ocrResults,
  type ScanSessionRow,
  type OcrResultRow,
} from "./schema.js";

const RESOURCE_SCAN_SESSION = "scan_session";
const RESOURCE_OCR_RESULT = "ocr_result";

/** Cache TTL: 60s (scan results update during processing). */
const SESSION_TTL = 60;

// ── Single-entity lookups ─────────────────────────────────────────────────

/**
 * Get a scan session by tenant + session ID.
 * Cache key: `visitor:{tenantId}:scan_session:{sessionId}` (TTL 60s).
 */
export async function getScanSession(tenantId: string, sessionId: string): Promise<ScanSessionRow | null> {
  return cache.getOrLoad<ScanSessionRow>(
    cache.makeKey(tenantId, RESOURCE_SCAN_SESSION, sessionId),
    async () => {
      const rows = await db
        .select()
        .from(scanSessions)
        .where(and(eq(scanSessions.id, sessionId), eq(scanSessions.tenantId, tenantId)))
        .limit(1);
      return rows[0] ?? null;
    },
    SESSION_TTL,
  );
}

/**
 * Get OCR result by tenant + scan session ID.
 * Cache key: `visitor:{tenantId}:ocr_result:{sessionId}` (TTL 60s).
 */
export async function getOcrResult(tenantId: string, sessionId: string): Promise<OcrResultRow | null> {
  return cache.getOrLoad<OcrResultRow>(
    cache.makeKey(tenantId, RESOURCE_OCR_RESULT, sessionId),
    async () => {
      const rows = await db
        .select()
        .from(ocrResults)
        .where(and(eq(ocrResults.scanSessionId, sessionId), eq(ocrResults.tenantId, tenantId)))
        .limit(1);
      return rows[0] ?? null;
    },
    SESSION_TTL,
  );
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

  const [data, totalResult] = await Promise.all([
    db
      .select()
      .from(scanSessions)
      .where(where)
      .limit(pageSize)
      .offset(offset)
      .orderBy(desc(scanSessions.createdAt)),
    db
      .select({ total: count() })
      .from(scanSessions)
      .where(where),
  ]);

  const total = totalResult[0]?.total ?? 0;

  return { data, meta: { page, pageSize, total } };
}
