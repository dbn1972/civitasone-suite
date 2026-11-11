# @civitasone/search

Provider-agnostic search engine adapter for CivitasOne Suite.

## Supported Engines

| Engine | Best For | Managed Option |
|--------|----------|----------------|
| **Meilisearch** (default) | On-prem, small offices, single-server | Self-hosted only |
| **OpenSearch** | AWS deployments, enterprise scale, analytics + search | Amazon OpenSearch Service |

## Usage

```typescript
import { createSearchEngine } from "@civitasone/search";

// Reads SEARCH_ENGINE env var ("meilisearch" or "opensearch")
const engine = createSearchEngine();
await engine.initialize();

// Index a document
await engine.index({
  id: "doc-uuid",
  tenantId: "tenant-uuid",
  documentId: "ref-uuid",
  title: "Budget Sanction Order 2026-27",
  content: "Sanctioned amount of ₹50 lakhs for...",
  tags: ["finance", "budget", "sanction"],
  category: "finance",
});

// Search
const results = await engine.search({
  q: "budget sanction",
  tenantId: "tenant-uuid",
  limit: 20,
});

// Remove
await engine.remove("tenant-uuid", "ref-uuid");

// Shutdown
await engine.close();
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SEARCH_ENGINE` | `meilisearch` | Provider: `meilisearch` or `opensearch` |
| `MEILISEARCH_HOST` | `http://localhost:7700` | Meilisearch URL |
| `MEILISEARCH_API_KEY` | _(empty)_ | Meilisearch API key |
| `OPENSEARCH_NODE` | `http://localhost:9200` | OpenSearch URL |
| `OPENSEARCH_USERNAME` | _(empty)_ | OpenSearch basic auth user |
| `OPENSEARCH_PASSWORD` | _(empty)_ | OpenSearch basic auth password |

### Programmatic

```typescript
import { MeilisearchEngine, OpenSearchEngine } from "@civitasone/search";

// Direct instantiation with options
const meili = new MeilisearchEngine({ host: "http://meili:7700", apiKey: "key" });
const os = new OpenSearchEngine({ node: "https://vpc-search.ap-south-1.es.amazonaws.com", shards: 3 });
```

## Architecture

```
┌─────────────────────────────────────────┐
│           @civitasone/search            │
│                                         │
│  SearchEngine interface (types.ts)      │
│    ├── MeilisearchEngine                │
│    └── OpenSearchEngine                 │
│                                         │
│  createSearchEngine() factory           │
└─────────────────────────────────────────┘
         │                    │
         ▼                    ▼
   ┌───────────┐      ┌─────────────┐
   │Meilisearch│      │ OpenSearch   │
   │  (Rust)   │      │  (Java)     │
   └───────────┘      └─────────────┘
```

## Tenant Isolation

Both engines enforce tenant isolation via **filter-based isolation** in a shared index:
- Every document carries `tenantId`
- Every query includes a mandatory `tenantId` filter
- Cross-tenant data access is impossible through the search layer

## Fallback Behavior

If the search engine is unreachable, the knowledge-service falls back to a PostgreSQL ILIKE query on the local `search_index` table. This ensures search remains functional (though slower) during engine maintenance or outages.

## Cross-module global search (per-tenant flag, default off)

Index `global_search` holds finance vouchers/bills/vendors, HR employees (name + number only), procurement indents/POs.
Contract: `src/global/` (`catalogue.ts` = types, roles, links; `contract.ts` = the only document shape; `pii.ts` = redaction).

- Switch on per tenant: `GLOBAL_SEARCH_TENANTS=<uuid>,<uuid>` in the gateway, knowledge-service worker and every producing service
  (`GLOBAL_SEARCH_DISABLED=1` is a global kill switch). Unset = today's behaviour, no events, no queries.
- Producers call `syncGlobalRecord` (via a per-service `shared/global-search.ts`) inside their write transaction -> outbox -> `search.index.update`
  (with `entityType`) -> knowledge-service worker `global-consumer.ts` -> Meilisearch.
- Backfill before switching a tenant on: `pnpm --filter @civitasone/<service> reindex:global-search -- --tenant <uuid>` (dry run), then `--apply`;
  `--limit N` caps per entity type, `--only <type> --after <id>` resumes, `--purge --apply` removes the tenant's slice.
- Optional hardening: create a search-only Meilisearch key and set `MEILISEARCH_SEARCH_KEY` + `MEILISEARCH_SEARCH_KEY_UID`; the gateway then signs each
  search with a per-tenant tenant token that the engine enforces server-side.
- Adding a module: add a catalogue entry (roles copied from the owning service's read guard), a `shared/global-search.ts`, one `syncX(tx, id)` call per write site, a backfill entity.
