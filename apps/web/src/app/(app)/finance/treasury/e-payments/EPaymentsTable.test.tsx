import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null }),
}));

import { EPaymentsTable } from "./EPaymentsTable";

describe("EPaymentsTable (GAP-FINANCE-TREASURY-E-PAYMENTS-03 / -05)", () => {
  const orders = [
    { id: "p1", referenceId: "PAY-1", beneficiary: "ACME Ltd", amountDisplay: "₹1,000.00", status: "Released" as const },
    { referenceId: "PAY-2", beneficiary: "No Id", amountDisplay: "₹5.00", status: "Pending Approval" as const },
  ];

  it("links a row with an id to the payment detail and leaves an id-less row plain", () => {
    render(<EPaymentsTable orders={orders} />);
    const links = screen.getAllByRole("link", { name: /Open/i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/finance/payments/p1");
  });

  it("colours Released green and Pending Approval amber", () => {
    render(<EPaymentsTable orders={orders} />);
    expect(screen.getByText("Released")).toHaveClass("pill", "good");
    expect(screen.getByText("Pending Approval")).toHaveClass("pill", "warn");
  });
});
