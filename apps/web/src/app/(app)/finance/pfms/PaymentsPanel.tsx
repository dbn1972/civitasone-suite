"use client";

import { useState } from "react";
import { SubmitPaymentForm } from "./SubmitPaymentForm";
import { PaymentStatusLookup } from "./PaymentStatusLookup";
import { SalaryBillForm } from "./SalaryBillForm";
import { PaymentAdviceForm } from "./PaymentAdviceForm";
import type { PfmsDepartment, PfmsMode } from "./types";

interface PaymentsPanelProps {
  departments?: PfmsDepartment[];
}

/**
 * There is no GET /v1/finance/pfms/payments list endpoint on finance-service —
 * POST /v1/finance/pfms/payments submits a payment to PFMS/e-Kuber (an action,
 * not a listing). This panel offers payment submission plus reference-based
 * status lookup, salary-bill generation, and payment-advice generation —
 * every mutation below points at a route verified present in
 * services/finance-service/src/modules/pfms/{adapter-routes,treasury-stubs}.ts.
 *
 * Sandbox/live banner: there is no dedicated PFMS status endpoint to read
 * upfront (GET /v1/finance/pfms/config — see ConfigPanel — only carries
 * per-tenant agency code / default DDO, not integration mode). Until one
 * exists, this tracks the `mode` field the backend PFMS adapter rollout is
 * adding to each submission/lookup response below. Nothing renders until the
 * first response comes back, so this stays silent rather than guessing at
 * sandbox/live state.
 */
export function PaymentsPanel({ departments = [] }: PaymentsPanelProps) {
  const [mode, setMode] = useState<PfmsMode | null>(null);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {mode && mode !== "live" && (
        <div className="alert warn" role="status" aria-live="polite">
          <strong>Sandbox Mode</strong>
          <p>
            PFMS credentials are not configured. Submissions are simulated and will not reach the
            government payment gateway.
          </p>
        </div>
      )}
      <SubmitPaymentForm onModeObserved={setMode} />
      <PaymentStatusLookup onModeObserved={setMode} />
      <SalaryBillForm departments={departments} onModeObserved={setMode} />
      <PaymentAdviceForm onModeObserved={setMode} />
    </div>
  );
}
