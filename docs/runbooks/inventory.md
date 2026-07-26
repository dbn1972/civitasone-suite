# Runbook: inventory-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, p95 read < 300 ms, stock accuracy (cycle-count variance < 2%).

- **Purpose:** government store/inventory management — item master (categories, units, reorder levels, valuation method), store/warehouse management, GRN receipts (from procurement), issue/consumption, inter-store transfers, stock adjustments with reason codes, batch/serial tracking, cycle-count with approval, three-way matching (PO-GRN-Invoice), goods returns with QC inspection, reservations/allocations, bin/rack location management, batch quarantine/recall, and demand forecasting. Owns `civitas_inventory`. Stock movements are valued in paise using weighted-average costing.

- **Owner / escalation:** primary: Stores/Inventory Domain Owner. Secondary: SRE. Page on negative-stock events (data integrity) or three-way match systematic failures.

- **Dependencies:**
  - Own Postgres DB (`civitas_inventory`), RLS enabled, tenant-scoped.
  - Redis — read-through cache for stock levels, item master, reorder alerts.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for item CRUD, category/UOM, substitute, bin, reservation, goods-return, store/warehouse CRUD, receipt/issue/transfer/adjustment, batch CRUD/quarantine/recall, serial register, cycle-count lifecycle, three-way match; events for stock movements, cycle-count outcomes.
  - Cross-service: procurement-service (GRN triggers receipt), finance-service (three-way match feeds into bill verification), stock-service (related but distinct — stock-service handles e-way bills and proxy aggregation).
  - Valuation: weighted-average cost per item per store. All amounts in BigInt paise. Valuation recalculates on every receipt/adjustment.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: stock value by store, movement rate (receipts/issues per day), items below reorder level, cycle-count variance, three-way match pass/fail rate, batch expiry alerts.
  - Alert: negative stock detected = CRITICAL (data integrity issue); cycle-count variance > 5% = WARN; items below reorder level > 20% = WARN.

- **Common failure modes → action:**
  - *Negative stock after issue* → the issue consumer validates available quantity before deducting. If negative stock appears, it's usually a race condition between concurrent issues for the same item. The domain should reject with `INSUFFICIENT_STOCK` — if it's not, check the stock-level check is inside the transaction (SELECT FOR UPDATE on the stock row).
  - *Three-way match systematic mismatch* → if most GRNs are mismatching against POs, check if PO amendments are not propagating to inventory's expected-receipt data. The match compares quantity + rate from PO vs actual GRN vs invoice.
  - *Cycle-count approval stuck* → cycle-counts require approval when the variance exceeds a threshold (configurable per store). If no approver is assigned, the count stays pending. Check workflow-service for the approval instance.
  - *Batch recall not propagating* → a recalled batch should prevent any further issues from that batch. Verify the quarantine flag is set on the batch row and that the issue consumer checks batch status before deducting.
  - *Weighted-average valuation drift* → valuation recalculates on every receipt. If values seem wrong, check the receipt sequence — a receipt with an abnormally high/low price can skew the average. This is mathematically correct behavior but may need business review.
  - *Reservation not releasing on fulfillment* → reservations lock stock for future use. When the corresponding issue is created, the reservation should auto-release. If it's not releasing, check the linkage between reservation ID and the issue command.

- **Rollback:** redeploy previous image tag. Stock movements are append-only (journal-style). Valuation is computed from the movement history — it rebuilds correctly on replaying receipts.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) run a stock reconciliation (sum of movements should equal current balance per item per store); (2) verify no duplicate receipts (GRN-to-receipt is idempotent by GRN ID); (3) re-compute weighted-average valuation from movement history if any values seem inconsistent.
