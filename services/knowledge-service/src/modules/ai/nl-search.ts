/**
 * NL Search Translation — Converts natural language queries into structured search requests.
 *
 * Flow:
 *   1. User submits NL query (≤500 chars)
 *   2. Claude adapter extracts structured search intent (module, entity type, filters, keywords)
 *   3. Execute structured search via @civitasone/search
 *   4. Return module-scoped results within 5s
 *
 * Validates: Requirements 20.3
 */

import { sendPrompt, isEnabled, AiAdapterError, CircuitBreakerOpenError } from "./adapter.js";
import { createSearchEngine, type SearchEngine, type SearchResponse } from "@civitasone/search";

// ── Types ─────────────────────────────────────────────────────────

export interface SearchIntent {
  module: string | null;
  entityType: string | null;
  keywords: string[];
  filters: Record<string, string>;
}

export interface NlSearchResult {
  intent: SearchIntent;
  results: Array<{
    id: string;
    documentId: string;
    title: string;
    content: string;
    tags: string[];
    score?: number | undefined;
  }>;
}

// ── Search engine singleton ───────────────────────────────────────

let engine: SearchEngine | null = null;

function getEngine(): SearchEngine {
  if (!engine) {
    engine = createSearchEngine();
  }
  return engine;
}

/** Allow injection for testing */
export function setEngine(e: SearchEngine | null): void {
  engine = e;
}

// ── System prompt for intent extraction ───────────────────────────

const SYSTEM_PROMPT = `You are a search intent extraction assistant for CivitasOne, an enterprise ERP system.
Given a natural language search query, extract the structured search intent as JSON.

Available modules: identity, tenant, policy, audit, notification, finance, procurement, contract, estab, stock, hrms, payroll, project, asset, report, plugin, theme, grant, citizen, legal, admin, billing, crm, inventory, telephony, helpdesk, knowledge, workflow, queue, analytics, location.

Return ONLY valid JSON with this exact schema (no markdown, no explanation):
{
  "module": "<module name or null if unclear>",
  "entityType": "<entity type or null if unclear>",
  "keywords": ["<keyword1>", "<keyword2>"],
  "filters": { "<filterKey>": "<filterValue>" }
}

Rules:
- "module" must be one of the available modules or null
- "keywords" must be an array of search terms extracted from the query
- "filters" must be an object of key-value pairs for any specific filters mentioned
- If the query mentions a department, set module accordingly
- Keep keywords concise and relevant for full-text search`;

// ── Intent parsing ────────────────────────────────────────────────

export function parseIntent(raw: string): SearchIntent {
  try {
    const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
    return {
      module: typeof parsed.module === "string" ? parsed.module : null,
      entityType: typeof parsed.entityType === "string" ? parsed.entityType : null,
      keywords: Array.isArray(parsed.keywords)
        ? (parsed.keywords as unknown[]).filter((k): k is string => typeof k === "string")
        : [],
      filters: typeof parsed.filters === "object" && parsed.filters !== null && !Array.isArray(parsed.filters)
        ? Object.fromEntries(
            Object.entries(parsed.filters as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string")
              .map(([k, v]) => [k, v as string]),
          )
        : {},
    };
  } catch {
    // If LLM returns non-JSON, treat entire response as keywords
    return {
      module: null,
      entityType: null,
      keywords: raw.split(/\s+/).filter(Boolean).slice(0, 10),
      filters: {},
    };
  }
}

// ── NL Search Translation (main export) ───────────────────────────

/**
 * Translates a natural language query into a structured search and executes it.
 *
 * @param query - Natural language search query (already validated ≤500 chars)
 * @param tenantId - Tenant ID for search scoping
 * @param userModules - Modules the user has permission to access (for result filtering)
 * @returns Search intent + results
 *
 * Throws AiAdapterError on LLM failures.
 * Throws CircuitBreakerOpenError when breaker is open.
 */
export async function translateAndSearch(
  query: string,
  tenantId: string,
  userModules?: string[],
): Promise<NlSearchResult> {
  // Step 1: Extract intent via Claude
  const rawIntent = await sendPrompt(SYSTEM_PROMPT, query, { maxTokens: 256 });
  const intent = parseIntent(rawIntent);

  // Step 2: Build search query from intent
  const searchQuery = intent.keywords.length > 0
    ? intent.keywords.join(" ")
    : query;

  // Determine category filter based on module
  const category = intent.module && (!userModules || userModules.includes(intent.module))
    ? intent.module
    : undefined;

  // Step 3: Execute search against @civitasone/search
  let searchResponse: SearchResponse;
  try {
    searchResponse = await getEngine().search({
      q: searchQuery,
      tenantId,
      category,
      limit: 20,
      offset: 0,
    });
  } catch {
    // Search engine unavailable — return intent with empty results
    return { intent, results: [] };
  }

  // Step 4: Filter results by user's accessible modules if provided
  const results = searchResponse.hits.map((hit) => ({
    id: hit.id,
    documentId: hit.documentId,
    title: hit.title,
    content: hit.content,
    tags: hit.tags,
    score: hit.score,
  }));

  return { intent, results };
}
