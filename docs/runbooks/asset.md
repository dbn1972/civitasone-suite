# Runbook: asset-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, p95 read < 300 ms, depreciation run reliability 100% (financial reporting depends on it).

- **Purpose:** fixed asset lifecycle management — asset register (creation from GRN/procurement), transfer between locations/departments, disposal (condemnation survey → recommendation → approval → auction), depreciation scheduling/run (SLM/WDV methods), maintenance planning with work orders, meter-reading tracking (threshold breach alerts), impairment testing, insurance policy/claim management, fleet/device management, and enterprise asset dashboard. Owns `civitas_asset`. 11 modules handling government fixed assets per GFR rules.

- **Owner / escalation:** primary: Asset/Property Domain Owner. Secondary: SRE + Finance Domain Owner (depreciation feeds GL). Page on depreciation run failure (financial statements depend on it).

- **Dependencies:**
  - Own Postgres DB (`civitas_asset`), RLS enabled, tenant-scoped.
  - Redis — read-through cache for asset register, maintenance schedules, depreciation status.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for asset CRUD/transfer/dispose, depreciation schedule/run, maintenance plan, work-order lifecycle, meter-reading, impairment-test, insurance policy/claim, condemnation survey/recommend/approve, auction create/complete; events for asset created/transferred/disposed, depreciation posted, meter-reading recorded/threshold-breached, impairment-test completed.
  - Cross-service consumed: `procurement.grn.accepted` (auto-registers new assets from procurement GRN), `asset.disposal.file_decided` (estab-service eOffice callback for disposal approval), `works.asset.handover` (works-service completion creates a new asset — infrastructure handover).
  - Cross-service produces: `asset.dep.posted` (consumed by finance-service for GL journal entries), `asset.asset.created` (consumed by analytics for asset growth dashboards).
  - Financial: depreciation amounts in BigInt paise; method (SLM/WDV) configured per asset category; depreciation feeds the finance-service GL.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: total asset value (gross/net/WDV), depreciation schedule adherence, maintenance work-order backlog, meter-threshold breaches, condemnation pipeline, insurance coverage.
  - Alert: depreciation run failure = CRITICAL (month-end financial reporting blocked); meter threshold breach = WARN (maintenance required); condemnation approval overdue > 60 days = WARN.

- **Common failure modes → action:**
  - *Depreciation run failing* → the dep-run processes all assets in the tenant by category. If it fails midway, check which asset caused the error (usually a missing useful-life or cost-basis value). The run is resumable — fix the data issue and re-trigger for the failed batch. Run outputs feed finance-service GL — ensure the run completes before period-close.
  - *Asset registration from GRN not creating* → verify the `procurement.grn.accepted` consumer is healthy. The consumer checks if the GRN items are categorized as capital (vs consumable). Only capital items auto-register as assets. If the item category is misconfigured, fix it in procurement-service.
  - *Condemnation approval stuck in eOffice* → the disposal workflow routes through estab-service eOffice for high-value assets. If the callback isn't arriving, check estab-service outbox. The asset stays in `pending_disposal` state — safe (no asset is condemned without approval).
  - *Works asset handover not registering* → verify the `works.asset.handover` consumer received the event. Works-service emits this when a public works project is completed and the built asset (road, building, bridge) needs to be registered.
  - *Meter threshold breach flooding alerts* → meter readings that exceed configured thresholds trigger maintenance alerts. If a meter is consistently above threshold, the threshold may need adjustment (business decision) or the asset needs urgent maintenance.
  - *Impairment test incorrect* → impairment tests compare net book value against recoverable amount. If the test produces unexpected results, verify the recoverable-amount input data. Impairment loss is posted to finance GL — incorrect tests have financial reporting impact.

- **Rollback:** redeploy previous image tag. Asset register is append-only (transfers create new location records, not updates). Depreciation postings are journal entries — never delete, issue reversals instead.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) verify depreciation run status for the current period — if it ran during the gap, confirm the GL posting event was emitted; (2) reconcile asset register totals against finance-service fixed-asset GL balances; (3) check if any GRN-to-asset registrations were lost during the gap.
