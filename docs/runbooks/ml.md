# Runbook: ml-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.0% availability, inference p95 < 500 ms, predictions are advisory only (never block business flows).

- **Purpose:** centralized ML/AI infrastructure — feature store (cross-domain feature engineering), model registry (version-controlled model lifecycle), training pipelines, inference engine (real-time predictions via API), experiment tracking, algorithm library, observability (model drift, data drift, performance metrics), platform integration (consuming domain events to enrich features and trigger predictions), prediction publishing (advisory signals consumed by domain services), and automated purge (DPDP-compliant model artifact cleanup). Owns `civitas_ml`. 13 modules. All predictions are ADVISORY — they never block core workflows.

- **Owner / escalation:** primary: Data Science / ML Engineering. Secondary: SRE. No paging required — ML degradation means domain services lose predictive intelligence but continue functioning normally.

- **Dependencies:**
  - Own Postgres DB (`civitas_ml`), RLS enabled, tenant-scoped. Stores model metadata, feature definitions, prediction logs, experiment results.
  - Redis — feature cache (pre-computed features for real-time inference), prediction result cache.
  - SQS/RabbitMQ topics (events published): `ml.prediction.lead_scored` (CRM lead conversion), `ml.prediction.breach_risk_high` (helpdesk SLA breach), `ml.prediction.anomaly_detected` (finance transaction Z-score), `ml.prediction.churn_risk_high` (billing subscription churn), `ml.prediction.task_high_risk` (project delay).
  - Cross-service consumed: domain events from finance (transactions → anomaly features), billing (subscription updates → churn features), crm (lead updates → conversion features), helpdesk (ticket updates → breach features), project (task updates → delay features).
  - Storage: model artifacts (trained weights, serialized models) stored in S3/MinIO.
  - Compute: training jobs may require GPU/high-memory instances (configured via `TRAINING_INSTANCE_TYPE` env var).

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: inference rate by domain, inference latency p50/p95, prediction accuracy (measured vs actual outcomes), feature freshness, model version distribution, data/concept drift metrics, training job success rate.
  - Alert: inference latency > 2s = WARN (but non-blocking); model accuracy below threshold = WARN (model needs retraining); feature ingestion lag > 10min = WARN; training job failure = INFO (investigate, not urgent).

- **Common failure modes → action:**
  - *Inference returning stale predictions* → features may be outdated if the feature-store ingestion consumer is lagging. Check the domain-event consumers (finance/billing/crm/helpdesk/project). If a specific domain's events stopped flowing, the issue is upstream. Predictions remain at their last-computed value until new features arrive.
  - *Model training job failing* → training jobs are long-running and resource-intensive. Common failures: OOM (increase training memory), data quality issues (missing/null features in training set), or timeout (complex models on large datasets). Check training logs in the experiment tracker.
  - *Anomaly detection false positives flooding finance* → the Z-score threshold (default > 3) may be too aggressive for a tenant's transaction patterns. Adjust the threshold per-domain or per-tenant. False positives are handled by finance-service's resolution-intake module — they don't auto-trigger financial actions.
  - *Lead scoring not producing results* → verify CRM events are being consumed (`crm.lead.created`, `crm.lead.updated`). If features aren't populating, the prediction can't run. Also verify the lead-scoring model is deployed (active version in model registry).
  - *Churn prediction accuracy declining* → model drift over time is expected. When accuracy drops below threshold, trigger a retraining job with recent data. The existing model continues serving until the new one is validated and promoted.
  - *DPDP purge not executing* → model artifacts older than the configured retention period should be purged. If purge is failing, check for model versions still marked as "active" (active models are never purged). Deactivate old models before expecting purge.
  - *Feature store inconsistency* → features are computed from domain events. If the same entity has conflicting features (stale + fresh), the latest-timestamp feature wins. This is eventually consistent by design.

- **Rollback:** redeploy previous image tag. Model artifacts in S3 are versioned — rollback doesn't affect stored models. To rollback a model version, use the model registry to promote the previous version to active.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) verify active model versions in the registry match what's deployed (S3 artifacts are immutable); (2) rebuild the feature cache from the feature store (features are derived data — they can be recomputed from domain events if needed, though this is expensive); (3) prediction logs from the gap period are lost but non-critical (predictions are advisory).

- **Architectural note:** ml-service is intentionally decoupled from all business-critical paths. No domain service waits synchronously for an ML prediction. If ml-service is entirely down, the platform functions normally — just without predictive intelligence. This is by design.
