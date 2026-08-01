"use client";

import { SubmitPaymentForm } from "./SubmitPaymentForm";
import { PaymentStatusLookup } from "./PaymentStatusLookup";
import { SalaryBillForm } from "./SalaryBillForm";
import { PaymentAdviceForm } from "./PaymentAdviceForm";

/**
 * There is no GET /v1/finance/pfms/payments list endpoint on finance-service —
 * POST /v1/finance/pfms/payments submits a payment to PFMS/e-Kuber (an action,
 * not a listing). This panel offers payment submission plus reference-based
 * status lookup, salary-bill generation, and payment-advice generation —
 * every mutation below points at a route verified present in
 * services/finance-service/src/modules/pfms/{adapter-routes,treasury-stubs}.ts.
 */
export function PaymentsPanel() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <SubmitPaymentForm />
      <PaymentStatusLookup />
      <SalaryBillForm />
      <PaymentAdviceForm />
    </div>
  );
}
