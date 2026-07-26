# Runbook: stock-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, p95 read < 300 ms.

- **Purpose:** stock register and e-way bill management — item master, warehouse management, stock entry (receipt/issue/transfer/adjustment), physical stock verification, stock ledger, e-way bill generation/cancellation/vehicle-update (GST compliance), stock valuation (FIFO/weighted-average), and dashboard. Owns `civitas_stock`. Distinct from inventory-service: stock-service focuses on the stock register (government store accounts) and e-way bill compliance, while inventory-service handles operational store management.

- **Owner / escalation:** primary: Stores Domain Owner. Secondary: SRE. Page on e-way bill generation failure (GST compliance — goods cannot move without valid e-way bill).

- **Dependencies:**
  - Own Postgres DB (`civitas_stock`), RLS enabled, tenant-scoped.
  - Redis — read-through cache for stock balances, item master, ledger views.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for item create, warehouse create, entry create, physical create, e-way bill generate/cancel/update-vehicle; events for entry created, stock-negative rejection.
  - Cross-service consumed: `procurement.grn.accepted` (auto-creates stock entry on GRN acceptance).
  - External: GST e-Way Bill portal (`EWB_API_URL`, env-gated, circuit-breaker wrapped) for generation/cancellation of e-way bills for inter-state goods movement.
  - Valuation: negative stock is rejected by domain logic (event `stock.stock.negative_rejected` emitted). All amounts in BigInt paise.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: stock value by warehouse, entry volume (daily), e-way bill generation success rate, negative-stock rejections, physical verification variance.
  - Alert: e-way bill API failure = WARN (GST compliance risk); negative-stock rejections > 5/day = investigate data quality.

- **Common failure modes → action:**
  - *E-way bill generation failing* → check GST portal status; circuit breaker handles transient failures. If persistently failing, verify API credentials (`EWB_USERNAME`, `EWB_PASSWORD`). E-way bills have a validity period — if generation was delayed, the goods movement date must be within the bill's validity.
  - *Negative stock rejection on valid entry* → the stock-level check is strict. If a user expects sufficient stock but it's being rejected, check if a concurrent entry consumed the stock first. Review the stock ledger for the item+warehouse combination.
  - *GRN auto-entry not creating* → verify the `procurement.grn.accepted` consumer is healthy. The consumer maps GRN details (item, quantity, rate) to a stock entry. If the item doesn't exist in stock-service's item master, the entry will fail — ensure item master sync between procurement and stock.
  - *Physical verification variance* → physical stock counts may differ from system records. The variance is recorded but doesn't auto-adjust (requires approval). If variance is consistently high, investigate whether entries are being missed (manual receipts not recorded in system).
  - *E-way bill vehicle update failing* → vehicle updates are allowed within the e-way bill validity period. If the bill has expired, a new bill must be generated. The update endpoint validates the bill status before allowing changes.

- **Rollback:** redeploy previous image tag. Stock entries are append-only (ledger-style). E-way bill numbers from the GST portal are immutable once generated.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) verify stock ledger balances match sum of entries; (2) reconcile e-way bill numbers against the GST portal (any bills generated during the gap are still valid on the portal); (3) re-process any pending GRN events that may have arrived during downtime.
