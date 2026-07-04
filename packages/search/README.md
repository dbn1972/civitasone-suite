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
