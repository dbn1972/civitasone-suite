# Runbook: visitor-service

> Tier 2 (physical security implications). Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, check-in p95 < 2s (gate throughput), badge generation < 3s, evacuation response < 1s.

- **Purpose:** visitor and premises management — visit request lifecycle (create/approve/reject/cancel with auto-reject), digital pass generation/revocation/replacement, check-in/check-out recording with overstay detection, identity verification (DigiLocker + Aadhaar face-match), blacklist/watchlist management with approval workflow, material pass (goods in/out reconciliation), vehicle pass with parking slot management, group visit handling (bulk check-in), recurring passes (contractors/regular visitors), evacuation management (declare/mark-safe), turnstile control integration, badge printing, document scanning, VIP handling, DPDP compliance (data retention/purge), and premises analytics. Owns `civitas_visitor`. PII-heavy (visitor identity, photos, Aadhaar face data — all encrypted).

- **Owner / escalation:** primary: Security/Premises Domain Owner. Secondary: SRE. Page on check-in system failure (physical security breach risk — visitors cannot be processed at gates) or evacuation system failure (life safety).

- **Dependencies:**
  - Own Postgres DB (`civitas_visitor`), RLS enabled, tenant-scoped. PII encrypted (visitor name, phone, Aadhaar, photos).
  - Redis — read-through cache for pass validation (gates query pass status on every entry), blacklist lookups (must be fast — < 50ms for gate decisions), analytics computations.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for visit-request lifecycle, pass generate/revoke/replace, check-in/check-out, overstay-detect, identity verification (DigiLocker/Aadhaar), blacklist/watchlist, material-pass/vehicle-pass, group-visit, recurring-pass, evacuation, analytics; events for visitor.checked_in, visitor.overstay.alerted (consumed by analytics-service).
  - Cross-service: notification-service (visitor arrival SMS, overstay alerts, evacuation notices), analytics-service (footfall metrics, overstay patterns).
  - External: DigiLocker (identity verification, env-gated), Aadhaar face-match API (biometric verification), turnstile/barrier control hardware (via webhook/API adapter).
  - Performance-critical paths: check-in (gate throughput — must respond in < 2s), blacklist lookup (real-time decision at gate), pass validation (QR code scan verification).

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: visitor footfall (hourly/daily), average gate processing time, overstay count, blacklist hit rate, material-pass reconciliation (in vs out), vehicle occupancy, evacuation readiness score.
  - Alert: check-in latency > 2s = CRITICAL (gate congestion); blacklist lookup failure = CRITICAL (security gap); overstay > 50 concurrent = WARN; evacuation system unreachable = CRITICAL.

- **Common failure modes → action:**
  - *Check-in processing slow (gate congestion)* → check-in must be fast (< 2s). If Redis is slow, pass validation degrades. The system should fall back to DB lookup if Redis is unavailable, but this is slower. Investigate Redis connection pool exhaustion. If hardware turnstiles are timing out, the issue is downstream (network to turnstile controller).
  - *Blacklist lookup cache miss* → blacklist entries MUST be in Redis for real-time gate decisions. If a blacklisted person clears the gate, investigate cache invalidation timing. On blacklist add, the cache must be immediately updated (not TTL-based). Verify the `visitor.blacklist.add` consumer invalidates the cache synchronously.
  - *Overstay detection not firing* → overstay detection runs periodically (checks visitors who checked in but haven't checked out past their pass validity). Verify the scheduled sweep is running. If a visitor's pass doesn't have an expiry time, overstay cannot be computed — check pass generation logic.
  - *Material pass reconciliation imbalance* → material entering the premises must match material leaving (quantity reconciliation). Imbalance indicates either unreported removal or data-entry gap at the exit gate. Flag for security review.
  - *Evacuation declaration stuck* → the evacuation module must be near-instant. If `visitor.evacuation.declare` is in DLQ, something is fundamentally wrong — this is the highest-priority command in the service. Investigate immediately; fall back to manual headcount if the system is unavailable.
  - *DigiLocker/Aadhaar verification failing* → external identity services may be down. Verification is optional in most modes (pre-approved visitors can bypass). If verification is mandatory for the visit type, queue the visitor for manual verification (present physical ID to security).
  - *Auto-reject not firing on expired requests* → visit requests past their validity without approval should auto-reject via `visitor.visit_request.auto_reject`. Verify the sweep job is running.
  - *DPDP purge not executing* → DPDP Act requires data deletion after retention period. The purge job removes old visitor records per configured retention policy. If it's failing, check for foreign-key constraints (analytics snapshots may reference purged records — verify cascade rules).

- **Rollback:** redeploy previous image tag. Check-in/check-out records are append-only (security audit trail). Passes are immutable once generated (revocation creates a new status record, not an update). Evacuation records are never deleted.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) verify the blacklist cache is current (force-rebuild from DB); (2) reconcile currently-checked-in visitors (anyone who checked in during the gap won't have a record — cross-reference with physical gate logs if available); (3) confirm evacuation readiness (all currently-checked-in visitors must be in the active-visitor list for headcount purposes).
