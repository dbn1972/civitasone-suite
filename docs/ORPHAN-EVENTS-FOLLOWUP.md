# Orphan events: class (a) follow-up (consumers to be built)

Source: PR #1929 (Architecture Guard + Contract Tests), owner decision 2026-10-07: "ok accepting your reccommendation".

These 35 topics are declared in `EVENTS` and genuinely emitted, but no service consumes them. They look like missing integrations (payments, ledger, notifications, dispatch). They are tracked debt, baselined in `tests/contract/known-defects.json` (`orphanEvents`, count 946), so the ratchet can only go down. Building each consumer is a separate follow-up; when one lands, remove its topic from the baseline (`BASELINE_WRITE=1 npx vitest run tests/contract/lib/baseline.test.ts`).

The other 247 new orphans are fire-and-forget audit/status events, allow-listed under `NO CONSUMER BY DESIGN (audit/status)` in `tests/contract/cross-service-events.no-consumer.ts`.

The probable consumer is a judgement from the topic name and emit site, not a verified integration map. The introducing PR is the first commit that added the topic string (`git log -S`); #614 is the large bulk commit that added the events maps for about 17 municipal services.

| Topic | Producing service | Probable consumer | Introduced by (merged PR) |
|---|---|---|---|
| `admin.tenant.lifecycle_notification` | admin-service | notification-service | #1832 |
| `citizen.service_request.submitted` | citizen-service | notification-service / crm-service | #1097 |
| `citizen.service_request.status_changed` | citizen-service | notification-service | #1097 |
| `crm.service_request.citizen_notified` | crm-service | notification-service | #1861 |
| `estab.consumable.reorder_required` | estab-service | inventory-service / procurement-service | #648 |
| `event.deposit.decided` | event-service | refund-service | #614 |
| `grant.uc.sod_violation` | grant-service | admin/audit alerting (compliance) | #805 |
| `hrms.employee.transferred` | hrms-service | payroll-service / attendance | #1552 |
| `inventory.payment.blocked` | inventory-service | finance-service (AP) | #644 |
| `inventory.payment.released` | inventory-service | finance-service (AP) | #644 |
| `inventory.srn.signed` | inventory-service | finance-service (AP) | #644 |
| `market.demand.generated` | market-service | revenue-service / finance-service | #614 |
| `market.demand.payment_recorded` | market-service | revenue-service / finance-service | #614 |
| `market.demand.waived` | market-service | revenue-service / finance-service | #614 |
| `parking.violation.paid` | parking-service | revenue-service / finance-service | #614 |
| `payroll.arrear.decided` | payroll-service | hrms-service / finance-service | #1821 |
| `payroll.correction.decided` | payroll-service | hrms-service / finance-service | #1761 |
| `payroll.flex_election.decided` | payroll-service | hrms-service | #1824 |
| `payroll.return_filing.recorded` | payroll-service | finance-service / compliance | #1823 |
| `procurement.grn.amended` | procurement-service | inventory-service | #646 |
| `procurement.po.dispatch_rejected` | procurement-service | vendor-service / notification-service | #1866 |
| `procurement.rfq.awarded` | procurement-service | vendor-service / procurement PO flow | #1229 |
| `refund.disbursement.initiated` | refund-service | finance-service (ledger) | #614 |
| `refund.disbursement.completed` | refund-service | finance-service (ledger) | #614 |
| `refund.disbursement.failed` | refund-service | finance-service (ledger) | #614 |
| `refund.reconciliation.reconciled` | refund-service | finance-service (ledger) | #614 |
| `roadcut.deposit.decided` | roadcut-service | refund-service | #614 |
| `sewerage.bill.generated` | sewerage-service | revenue-service / finance-service | #614 |
| `sewerage.bill.paid` | sewerage-service | revenue-service / finance-service | #614 |
| `shop.application.fee_payment_recorded` | shop-service | finance-service | #614 |
| `shop.renewal.fee_payment_recorded` | shop-service | finance-service | #826 |
| `building.application.fee_payment_recorded` | building-service | finance-service | #614 |
| `trade.application.fee_payment_recorded` | trade-service | finance-service | #614 |
| `vendor.lifecycle.decided` | vendor-service | vendor-service licence updater (nothing updates `vendor_licences`; see `lifecycle/consumer.ts:252-260`) | #614 |
| `vendor.licence.fee_recorded` | vendor-service | finance-service | #614 |

## Related (left in their current class)
- `parking.pass.created` (parking-service, class b): carries an amount and a paymentRef but no challan, so a finance/revenue consumer may eventually be wanted. Review when scheduling the parking payment consumers.
- `admin.tenant.reactivated` (admin-service, class b): sibling of `admin.tenant.lifecycle_notification` (class a); review together when the tenant-lifecycle notification consumer is built.
