/**
 * visitor-service: badge-print reads (repo).
 *
 * Read-through via `cache.getOrLoad` for single-template lookup by ID and
 * active-template resolution by tenant+language+category. List queries go
 * straight to Postgres (RLS-scoped by tenant_id). Paginated results follow
 * the standard envelope:
 *   `{ data: T[], meta: { page, pageSize, total } }`
 *
 * Also provides:
 *   - Print job lookups (by ID and paginated list with filters)
 *   - Priority queue read (ZPOPMIN from Redis sorted set) for device polling
 *   - Template version chain traversal (walks previousVersionId chain)
 *
 * Requirements validated: 4.4, 4.5, 5.2, 5.4
 */
import { and, eq, count, desc } from "drizzle-orm";
import { Redis } from "ioredis";
import { scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import {
  badgeTemplates,
  printJobs,
  type BadgeTemplateRow,
  type PrintJobRow,
} from "./schema.js";

const RESOURCE_TEMPLATE = "badge_template";
const RESOURCE_PRINT_JOB = "print_job";

// ── Template TTL: 300s (templates change rarely) ──────────────────────────
const TEMPLATE_TTL = 300;

// ── Single-entity lookups ─────────────────────────────────────────────────

/**
 * `visitor:{tenantId}:badge_template:{templateId}` — cache.getOrLoad read-through (TTL 300s).
 * Returns null when the template does not exist or belongs to another tenant.
 */
export async function getTemplateById(tenantId: string, templateId: string): Promise<BadgeTemplateRow | null> {
  return cache.getOrLoad<BadgeTemplateRow>(
    cache.makeKey(tenantId, RESOURCE_TEMPLATE, templateId),
    async () => {
      // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
      // read — a bare db.select() runs with no RLS GUC set.
      const rows = await scopedRead((tx) =>
        tx
          .select()
          .from(badgeTemplates)
          .where(and(eq(badgeTemplates.id, templateId), eq(badgeTemplates.tenantId, tenantId)))
          .limit(1),
      );
      return rows[0] ?? null;
    },
    TEMPLATE_TTL,
  );
}

/**
 * Finds the active template for a given tenant + printer language + visitor category.
 * Cache key: `visitor:{tenantId}:badge_template:active:{printerLanguage}:{visitorCategory}` (TTL 300s).
 */
export async function getActiveTemplate(
  tenantId: string,
  printerLanguage: string,
  visitorCategory: string,
): Promise<BadgeTemplateRow | null> {
  const cacheKey = `visitor:${tenantId}:${RESOURCE_TEMPLATE}:active:${printerLanguage}:${visitorCategory}`;
  return cache.getOrLoad<BadgeTemplateRow>(
    cacheKey,
    async () => {
      // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
      // read — a bare db.select() runs with no RLS GUC set.
      const rows = await scopedRead((tx) =>
        tx
          .select()
          .from(badgeTemplates)
          .where(
            and(
              eq(badgeTemplates.tenantId, tenantId),
              eq(badgeTemplates.printerLanguage, printerLanguage),
              eq(badgeTemplates.visitorCategory, visitorCategory),
              eq(badgeTemplates.status, "active"),
            ),
          )
          .orderBy(desc(badgeTemplates.templateVersion))
          .limit(1),
      );
      return rows[0] ?? null;
    },
    TEMPLATE_TTL,
  );
}

// ── List queries (paginated) ──────────────────────────────────────────────

export interface TemplateListFilters {
  printerLanguage?: string;
  visitorCategory?: string;
  status?: string;
}

export interface PrintJobListFilters {
  deviceId?: string;
  status?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

/**
 * Paginated list of badge templates for a tenant with optional filters.
 * Follows the standard response envelope `{ data, meta: { page, pageSize, total } }`.
 */
export async function listTemplates(
  tenantId: string,
  filters: TemplateListFilters = {},
  page = 1,
  pageSize = 20,
): Promise<PaginatedResult<BadgeTemplateRow>> {
  const conditions = [eq(badgeTemplates.tenantId, tenantId)];
  if (filters.printerLanguage) conditions.push(eq(badgeTemplates.printerLanguage, filters.printerLanguage));
  if (filters.visitorCategory) conditions.push(eq(badgeTemplates.visitorCategory, filters.visitorCategory));
  if (filters.status) conditions.push(eq(badgeTemplates.status, filters.status));

  const where = and(...conditions);
  const offset = (page - 1) * pageSize;

  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before these
  // reads — a bare db.select() runs with no RLS GUC set.
  const [data, totalResult] = await scopedRead((tx) =>
    Promise.all([
      tx
        .select()
        .from(badgeTemplates)
        .where(where)
        .limit(pageSize)
        .offset(offset)
        .orderBy(desc(badgeTemplates.createdAt)),
      tx
        .select({ total: count() })
        .from(badgeTemplates)
        .where(where),
    ]),
  );

  const total = totalResult[0]?.total ?? 0;

  return { data, meta: { page, pageSize, total } };
}

// ── Print job lookups ─────────────────────────────────────────────────────

/**
 * Simple DB lookup for a print job by ID (no cache — jobs change frequently).
 */
export async function getPrintJobById(tenantId: string, jobId: string): Promise<PrintJobRow | null> {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(printJobs)
      .where(and(eq(printJobs.id, jobId), eq(printJobs.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Paginated list of print jobs for a tenant with optional filters (deviceId, status).
 * Follows the standard response envelope `{ data, meta: { page, pageSize, total } }`.
 */
export async function listPrintJobs(
  tenantId: string,
  filters: PrintJobListFilters = {},
  page = 1,
  pageSize = 20,
): Promise<PaginatedResult<PrintJobRow>> {
  const conditions = [eq(printJobs.tenantId, tenantId)];
  if (filters.deviceId) conditions.push(eq(printJobs.deviceId, filters.deviceId));
  if (filters.status) conditions.push(eq(printJobs.status, filters.status));

  const where = and(...conditions);
  const offset = (page - 1) * pageSize;

  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before these
  // reads — a bare db.select() runs with no RLS GUC set.
  const [data, totalResult] = await scopedRead((tx) =>
    Promise.all([
      tx
        .select()
        .from(printJobs)
        .where(where)
        .limit(pageSize)
        .offset(offset)
        .orderBy(desc(printJobs.createdAt)),
      tx
        .select({ total: count() })
        .from(printJobs)
        .where(where),
    ]),
  );

  const total = totalResult[0]?.total ?? 0;

  return { data, meta: { page, pageSize, total } };
}

// ── Priority queue read (Redis sorted set) ────────────────────────────────

/**
 * Redis sorted set store for print job priority queue.
 * Mirrors the revocation-store pattern — dedicated Redis client
 * because the shared `cache` singleton does not expose ZPOPMIN.
 */
interface PrintQueueStore {
  zpopmin(key: string): Promise<[string, number] | null>;
}

/** Real Redis-backed store. */
class RedisPrintQueueStore implements PrintQueueStore {
  constructor(private redis: Redis) {}
  async zpopmin(key: string): Promise<[string, number] | null> {
    const result = await this.redis.zpopmin(key, 1);
    if (!result || result.length < 2) return null;
    return [result[0] ?? "", Number(result[1])];
  }
}

/** In-memory store for dev/tests without a Redis instance. */
class MemoryPrintQueueStore implements PrintQueueStore {
  private sets = new Map<string, Array<{ member: string; score: number }>>();

  async zpopmin(key: string): Promise<[string, number] | null> {
    const set = this.sets.get(key);
    if (!set || set.length === 0) return null;
    // Sort ascending (lowest score first) and pop
    set.sort((a, b) => a.score - b.score);
    const entry = set.shift()!;
    return [entry.member, entry.score];
  }

  /** Test helper: add a member to the sorted set. */
  zadd(key: string, score: number, member: string): void {
    let set = this.sets.get(key);
    if (!set) {
      set = [];
      this.sets.set(key, set);
    }
    set.push({ member, score });
  }
}

let _queueStore: PrintQueueStore | null = null;

function getQueueStore(): PrintQueueStore {
  if (_queueStore) return _queueStore;
  const url = process.env.REDIS_URL;
  _queueStore =
    !url || process.env.CACHE_DRIVER === "memory"
      ? new MemoryPrintQueueStore()
      : new RedisPrintQueueStore(new Redis(url));
  return _queueStore;
}

/**
 * Override the print queue store — test-only seam so unit tests can inject an
 * in-memory or mock store without touching `REDIS_URL`/`CACHE_DRIVER`.
 * Pass `null` to reset to the default (env-driven) store.
 */
export function setPrintQueueStoreForTests(store: PrintQueueStore | null): void {
  _queueStore = store;
}

/**
 * Pop the next highest-priority print job for a device from the Redis sorted set.
 * Key: `visitor:{tenantId}:printer:{deviceId}:jobs`
 *
 * Uses ZPOPMIN to atomically get and remove the lowest-score member (lowest
 * score = highest priority). Returns the full print job record from DB, or
 * null if the queue is empty.
 *
 * Requirement 5.2: priority-ordered job delivery to printer devices.
 */
export async function getNextJobForDevice(tenantId: string, deviceId: string): Promise<PrintJobRow | null> {
  const key = `visitor:${tenantId}:printer:${deviceId}:jobs`;
  const entry = await getQueueStore().zpopmin(key);
  if (!entry) return null;

  const [jobId] = entry;
  // Fetch the full job record from Postgres
  return getPrintJobById(tenantId, jobId);
}

// ── Template version chain ────────────────────────────────────────────────

/**
 * Walk the previousVersionId chain to build a version history list for a template.
 * Returns an array ordered from newest to oldest version.
 *
 * Requirement 4.4: template versioning with audit trail.
 */
export async function getTemplateVersionChain(
  tenantId: string,
  templateId: string,
): Promise<BadgeTemplateRow[]> {
  const chain: BadgeTemplateRow[] = [];
  let currentId: string | null = templateId;

  // Safety limit to prevent infinite loops (max 50 versions)
  const MAX_CHAIN_LENGTH = 50;

  while (currentId && chain.length < MAX_CHAIN_LENGTH) {
    const template = await getTemplateById(tenantId, currentId);
    if (!template) break;
    chain.push(template);
    currentId = template.previousVersionId ?? null;
  }

  return chain;
}
