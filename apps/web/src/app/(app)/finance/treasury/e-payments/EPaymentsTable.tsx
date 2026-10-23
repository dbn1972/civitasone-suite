"use client";

import type { PaymentSummary } from "@civitasone/types";
import { PaymentsTable } from "../../payments/PaymentsTable";

/**
 * GAP-FINANCE-TREASURY-E-PAYMENTS-01: e-Payment Orders and Payments are two entries to ONE dataset
 * (GET /api/v1/finance/payments), so this renders the shared Payments register table: the same formatted
 * reference, the same exact-paise amount (sorted numerically), the same Pending / Released tabs and the same
 * row link to the payment. Only the offline-cache key, headings and the audited CSV export are this screen's own.
 */
export function EPaymentsTable({ orders, source = "api" }: { orders: PaymentSummary[]; source?: "api" | "error" }) {
  return (
    <PaymentsTable
      payments={orders}
      source={source}
      cacheKey="finance.epayment.orders"
      labels={{
        title: "Payment Orders",
        searchPlaceholder: "Search payment orders…",
        emptyIcon: "💳",
        emptyTitle: "No payment orders",
        emptyMessage: "No electronic payment orders found.",
      }}
      exportConfig={{ audit: "finance/treasury/e-payments", filename: "e-payment-orders" }}
    />
  );
}
