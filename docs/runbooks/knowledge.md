# Runbook: knowledge-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, p95 search < 500 ms.

- **Purpose:** organizational knowledge base — document management (CRUD with full-text search), category/tag hierarchy, version history with restore, content sharing (role-based access), retention policies (auto-archive/purge per policy), AI-powered assistant (Q&A over knowledge base), and search indexing (Meilisearch/OpenSearch via `@civitasone/search`). Owns `civitas_knowledge`. 9 modules. Serves as the organization's institutional memory.

- **Owner / escalation:** primary: Knowledge/Content Domain Owner. Secondary: SRE.

- **Dependencies:**
  - Own Postgres DB (`civitas_knowledge`), RLS enabled, tenant-scoped. Stores document metadata and content.
  - Redis — read-through cache for category trees, popular documents, search suggestions.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for document CRUD, category CRUD/reorder, retention-policy lifecycle, search index/reindex/remove, version create/restore, share create/revoke; events mirroring all mutations.
  - Search engine: Meilisearch / OpenSearch via `@civitasone/search` adapter. Full-text search, faceted filtering, typo-tolerance.
  - External: AI assistant endpoint (env-gated via `AI_ASSISTANT_ENABLED`) for conversational Q&A over the knowledge base. When assistant can't answer, escalates to helpdesk (`knowledge_assistant` source tag).
  - Storage: documents stored in S3/MinIO via `@civitasone/storage`.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: document count, search query rate, search latency p95, index freshness (lag between document update and search availability), retention purge rate, AI assistant usage.
  - Alert: search index lag > 5min = WARN (users see stale results); retention purge failure = WARN; AI assistant error rate > 10% = WARN.

- **Common failure modes → action:**
  - *Search returning stale results* → documents are indexed asynchronously (publish → consumer → search engine). If the search index is lagging, check the `knowledge.search.index` consumer. Common cause: search engine is under heavy load (reindexing). If critical, trigger a targeted reindex for the affected document.
  - *Retention purge not executing* → retention policies have a configured lifecycle (e.g., archive after 2 years, purge after 5 years). If purge isn't running, verify the scheduled sweep job. Documents under legal hold (from legal-service) MUST NOT be purged — verify the hold check is working.
  - *AI assistant escalating everything* → if the assistant can't find relevant content, it escalates to helpdesk. If escalation rate is very high, the knowledge base may be missing content in the area users are asking about. This is a content gap, not a system failure.
  - *Document upload failing* → large documents go to S3/MinIO. If uploads fail, check storage connectivity and bucket permissions. The upload is atomic — partial uploads are cleaned up.
  - *Version restore conflict* → restoring a document to a previous version creates a new version (append-only history). If restore fails, it's usually a concurrent edit conflict (optimistic locking). Retry with the latest version.
  - *Category reorder not reflecting* → category ordering is maintained via a `sortOrder` field. If reordering fails, check for duplicate `sortOrder` values within the same parent category.

- **Rollback:** redeploy previous image tag. Document content is versioned (all versions preserved). Search index can be rebuilt from source data (idempotent).

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) trigger a full reindex of the search engine (search index is derived — can be rebuilt); (2) verify document files in S3/MinIO are intact (they're stored outside the DB); (3) confirm retention holds from legal-service are still respected.
