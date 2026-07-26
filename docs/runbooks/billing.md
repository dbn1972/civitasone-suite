# Runbook: billing-service

> Tier 2. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, payment processing p95 < 3s, invoice generation < 10s, zero financial data loss.

- **Purpose:** SaaS subscription lifecycle (plan management, subscription activate/cancel/upgrade), usage-based billing, invoice generation with e-invoicing (GST e-Invoice via NIC portal), payment collection (Razorpay checkout), revenue recognition (accrual accounting), dunning/retry for failed payments, and churn risk integration with ml-service. Owns `civitas_billing`. Handles real money — double-spend guards and idempotency are critical.

- **Owner / escalation:** primary: Platform/Revenue Domain Owner. Secondary: SRE + Finance Domain Owner. Page on any payment-path DLQ entry or Razorpay webhook processing failure (revenue at risk).

- **Dependencies:**
  - Own Postgres DB (`civitas_billing`), RLS enabled, tenant-scoped.
  - Redis — subscription status cache, rate-limit counters for checkout endpoints, invoice generation deduplication.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for plan/subscription/invoice/payment/checkout/dunning/e-invoice/revenue lifecycle; events for subscription expiry, invoice issued/paid/cancelled, checkout completed/failed, dunning exhausted.
  - External integrations (circuit-breaker wrapped):
    - **Razorpay** (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) — payment gateway; webhook signature verification via `X-Razorpay-Signature`.
    - **NIC e-Invoice** (`EINVOICE_GSTIN`, `EINVOICE_API_URL`) — GST e-invoice generation/cancellation.
  - Cross-service consumed: `ml.prediction.churn_risk_high` (ml-service flags high-churn subscriptions for proactive retention).
  - Consumed by: finance-service (for GL posting of SaaS revenue), admin-service (tenant subscription status).

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: MRR (Monthly Recurring Revenue), churn rate, payment success rate, Razorpay webhook processing latency, e-invoice generation success rate, dunning retry effectiveness, subscription state distribution.
  - Alert: payment failure rate > 10% = WARN (provider issue); dunning exhausted > 5/day = investigate; e-invoice API timeout > 30s = WARN.

- **Common failure modes → action:**
  - *Razorpay webhook not processing* → verify webhook endpoint is registered in Razorpay dashboard; check that `RAZORPAY_WEBHOOK_SECRET` matches the configured value; verify gateway is forwarding `/api/v1/billing/webhooks/razorpay` correctly. Webhook signature mismatch → 401 response is correct behavior (do not bypass).
  - *DLQ on `billing.invoice.generate`* → common cause: subscription has no active plan (edge case during plan migration). Verify subscription state before redriving. If the plan was deleted, manually create a corrective invoice or skip.
  - *Dunning exhausted (subscription about to churn)* → this is expected business flow; verify the `billing.dunning.exhausted` event was emitted (triggers notification to tenant admin). Check if the payment method on file is expired.
  - *E-invoice generation failing* → check NIC portal status (frequent maintenance windows); circuit breaker will auto-retry. If persistently failing, queue will accumulate — safe because e-invoices can be generated retroactively within 24 hours. Do NOT manually generate outside the system (IRN collision risk).
  - *Revenue accrual mismatch* → verify the accrual processing job (`billing.revenue.accrual_process`) ran for the period. Accruals are period-locked — once a period closes, re-processing requires explicit unlock.
  - *Subscription state stuck in `pending_activation`* → check if the corresponding Razorpay checkout was completed; verify the `billing.checkout.verify` command was processed. May need manual activation via admin API if the webhook was lost.
  - *High checkout latency* → Razorpay API latency is outside our control; the circuit breaker will open at 5 consecutive timeouts. Checkout creation is async (returns a session URL) — user experience is only affected if the session URL generation itself is slow.

- **Rollback:** redeploy previous image tag. Financial data (invoices, payments) is append-only — never delete. If a bad invoice was generated, issue a credit note (separate command) rather than deleting the invoice row.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) reconcile Razorpay dashboard against local payment records — any payments received during the gap need manual recording; (2) verify no duplicate invoices by checking idempotency keys; (3) re-run accrual processing for the affected period.
