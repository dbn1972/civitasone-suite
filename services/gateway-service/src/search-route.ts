/**
 * Global Search Route — GET /api/v1/search
 *
 * Cross-module semantic search endpoint served directly by the gateway.
 * Authenticated, tenant-scoped, filtered by user's module permissions.
 *
 * Graceful degradation: returns 503 SEARCH_UNAVAILABLE if search engine unreachable.
 *
 * Validates: Requirements 19.2, 19.3, 19.4, 19.7
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createSearchEngine, type SearchEngine, type SearchResponse } from "@civitasone/search";
import type { CivitasJwtPayload } from "@civitasone/auth";
import { pino } from "pino";

const log = pino({ name: "gateway-search" });

// ── Role → Module Permission Mapping ──────────────────────────────────────────
// Maps JWT roles to the set of modules the user can access.
// super_admin / tenant_admin can access all modules.
const ROLE_MODULE_MAP: Record<string, string[]> = {
  finance_officer: ["finance"],
  finance_admin: ["finance"],
  procurement_officer: ["procurement"],
  procurement_admin: ["procurement"],
  hr_officer: ["hrms", "payroll"],
  hr_admin: ["hrms", "payroll"],
  audit_officer: ["audit"],
  asset_officer: ["assets"],
  asset_admin: ["assets"],
  project_officer: ["projects"],
  project_admin: ["projects"],
  legal_officer: ["legal"],
  legal_admin: ["legal"],
  citizen_officer: ["citizen"],
  helpdesk_agent: ["helpdesk"],
  helpdesk_admin: ["helpdesk"],
  crm_officer: ["crm"],
  crm_admin: ["crm"],
  inventory_officer: ["inventory", "stock"],
  billing_admin: ["billing"],
  report_viewer: ["reports"],
  analytics_viewer: ["analytics"],
  workflow_admin: ["workflow"],
  estab_officer: ["establishment"],
  estab_admin: ["establishment"],
  grant_officer: ["grants"],
  grant_admin: ["grants"],
  contract_officer: ["contracts"],
  contract_admin: ["contracts"],
  telephony_admin: ["telephony"],
  knowledge_admin: ["knowledge"],
  employee: ["hrms", "payroll"],
};

/** All searchable module keys used across the platform. */
const ALL_MODULES = [
  "finance", "procurement", "hrms", "payroll", "projects", "assets",
  "grants", "citizen", "legal", "crm", "helpdesk", "telephony",
  "knowledge", "workflow", "analytics", "billing", "inventory",
  "stock", "reports", "establishment", "contracts", "audit",
  "notification", "admin",
];

/**
 * Resolve modules the user is allowed to search based on JWT roles.
 * super_admin and tenant_admin get access to all modules.
 * platform_admin gets all modules.
 * Other roles get a union of their mapped modules.
 */
export function resolveUserModules(roles: string[]): string[] {
  const adminRoles = ["super_admin", "tenant_admin", "platform_admin"];
  if (roles.some((r) => adminRoles.includes(r))) {
    return ALL_MODULES;
  }

  const moduleSet = new Set<string>();
  for (const role of roles) {
    const modules = ROLE_MODULE_MAP[role];
    if (modules) {
      for (const m of modules) moduleSet.add(m);
    }
  }

  return Array.from(moduleSet);
}

// ── Search Result Shape ───────────────────────────────────────────────────────

export interface GlobalSearchResult {
  id: string;
  module: string;
  name: string;
  refNumber: string | null;
  description: string | null;
  status: string;
  snippet: string;
}

export interface GlobalSearchResponse {
  data: GlobalSearchResult[];
  meta: { page: number; pageSize: number; total: number };
}

// ── Search Engine Singleton ───────────────────────────────────────────────────

let engine: SearchEngine | null = null;

function getEngine(): SearchEngine {
  if (!engine) {
    engine = createSearchEngine();
  }
  return engine;
}

/** Allow injection for testing. */
export function setSearchEngine(e: SearchEngine | null): void {
  engine = e;
}

// ── Route Registration ────────────────────────────────────────────────────────

export function registerSearchRoute(app: FastifyInstance): void {
  app.get("/api/v1/search", async (req: FastifyRequest, reply: FastifyReply) => {
    // ── Authentication ─────────────────────────────────────────────────────
    const jwtPayload = (req as FastifyRequest & { jwtPayload?: CivitasJwtPayload }).jwtPayload;
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ") || !jwtPayload) {
      return reply.code(401).send({
        error: { code: "UNAUTHENTICATED", message: "Valid authentication required" },
      });
    }

    const tenantId = jwtPayload.tid ?? jwtPayload.tenantId;
    if (!tenantId) {
      return reply.code(401).send({
        error: { code: "UNAUTHENTICATED", message: "Tenant context required" },
      });
    }

    // ── Query Validation ───────────────────────────────────────────────────
    const query = (req.query as Record<string, string>).q ?? "";
    const pageStr = (req.query as Record<string, string>).page ?? "1";
    const pageSizeStr = (req.query as Record<string, string>).pageSize ?? "20";

    if (query.length < 2) {
      return reply.code(400).send({
        error: { code: "VALIDATION_FAILED", message: "Query must be at least 2 characters" },
      });
    }
    if (query.length > 200) {
      return reply.code(400).send({
        error: { code: "VALIDATION_FAILED", message: "Query must not exceed 200 characters" },
      });
    }

    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const pageSize = Math.min(20, Math.max(1, parseInt(pageSizeStr, 10) || 20));
    const offset = (page - 1) * pageSize;

    // ── Permission Filtering ───────────────────────────────────────────────
    const userModules = resolveUserModules(jwtPayload.roles ?? []);
    if (userModules.length === 0) {
      // User has no module access — return empty results
      return reply.code(200).send({
        data: [],
        meta: { page, pageSize, total: 0 },
      } satisfies GlobalSearchResponse);
    }

    // ── Execute Search ─────────────────────────────────────────────────────
    let searchResponse: SearchResponse;
    try {
      searchResponse = await getEngine().search({
        q: query,
        tenantId,
        limit: pageSize,
        offset,
        // Use tags for module filtering — indexed documents store module as a tag
        tags: userModules,
      });
    } catch (err) {
      // Graceful degradation: search engine unreachable
      log.warn(
        { correlationId: req.id, err: err instanceof Error ? err.message : "unknown" },
        "Search engine unreachable — returning SEARCH_UNAVAILABLE",
      );
      return reply.code(503).send({
        error: { code: "SEARCH_UNAVAILABLE", message: "Search service is temporarily unavailable" },
      });
    }

    // ── Transform and filter results by module permission ──────────────────
    const results: GlobalSearchResult[] = [];
    for (const hit of searchResponse.hits) {
      // Each hit has tags array; the module is stored as a tag
      const module = hit.tags.find((t) => userModules.includes(t)) ?? hit.tags[0] ?? "unknown";

      // Double-check module permission (defense-in-depth)
      if (!userModules.includes(module)) continue;

      results.push({
        id: hit.documentId,
        module,
        name: hit.title,
        refNumber: extractField(hit, "refNumber"),
        description: extractField(hit, "description"),
        status: extractField(hit, "status") ?? "unknown",
        snippet: hit.highlights?.title ?? hit.highlights?.content ?? truncate(hit.content, 150),
      });
    }

    const response: GlobalSearchResponse = {
      data: results,
      meta: {
        page,
        pageSize,
        total: searchResponse.totalHits,
      },
    };

    return reply.code(200).send(response);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractField(hit: { content: string; tags: string[] }, field: string): string | null {
  // In the search index documents, metadata may be encoded in content as JSON
  // or available via highlights. For our cross-module search, the indexing utility
  // stores: module, name (title), refNumber, description, status.
  // The SearchIndexDocument stores these in the content field as a structured string.
  // Try to extract from content if it looks like JSON metadata.
  try {
    if (hit.content.startsWith("{")) {
      const parsed = JSON.parse(hit.content) as Record<string, unknown>;
      const val = parsed[field];
      return typeof val === "string" ? val : null;
    }
  } catch {
    // Not JSON — fallback
  }
  return null;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + "...";
}
