import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null }),
}));

import { PaymentsTable } from "./PaymentsTable";

/**
 * L1/L2: /finance/payments/[id] renders a real detail (UTR, submit-for-approval)
 * but the register never linked to it — the web mapper dropped the backend row
 * id, so an officer could not open any payment. Rows must now link by id.
 */
describe("PaymentsTable — payment detail is reachable from the register", () => {
  it("links a payment row to /finance/payments/{id}", () => {
    render(
      <PaymentsTable
        payments={[
          {
            id: "11111111-1111-1111-1111-111111111111",
            referenceId: "11111111-1111-1111-1111-111111111111",
            beneficiary: "ACME Ltd",
            amountDisplay: "₹1,00,000.00",
            status: "Released",
          },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: /Open/i });
    expect(link).toHaveAttribute("href", "/finance/payments/11111111-1111-1111-1111-111111111111");
  });

  it("leaves a row without an id non-clickable (no dead link)", () => {
    render(
      <PaymentsTable
        payments={[
          { referenceId: "PAY-ABCDEF", beneficiary: "No Id Vendor", amountDisplay: "₹500.00", status: "Queued" },
        ]}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
