import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null }),
}));

import { EPaymentsTable } from "./EPaymentsTable";
import { PaymentsTable } from "../../payments/PaymentsTable";

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
    // "Released" is also a tab label (the shared register has Pending / Released tabs): pick the status pill.
    const pill = (text: string) => screen.getAllByText(text).find((el) => el.classList.contains("pill"));
    expect(pill("Released")).toHaveClass("pill", "good");
    expect(pill("Pending Approval")).toHaveClass("pill", "warn");
  });
});

// GAP-FINANCE-TREASURY-E-PAYMENTS-01: two entries, one dataset -> the same rows, the same links.
describe("EPaymentsTable renders the same rows as the Payments register", () => {
  const ID = "11111111-2222-4333-8444-555555555551";
  const orders = [
    // referenceId is a bare UUID (as the API sends when there is no EFT ref) and amountDisplay is stale on purpose:
    // the register derives the reference and shows the exact paise amount, so this screen must too.
    { id: ID, referenceId: ID, beneficiary: "Acme Supplies", amountDisplay: "stale", amountMinor: "123456789", status: "Released" as const },
    { id: "11111111-2222-4333-8444-555555555552", referenceId: "EFT-77", beneficiary: "Beta Traders", amountDisplay: "₹5.00", amountMinor: "500", status: "Pending Approval" as const },
  ];
  const bodyRows = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("tbody tr")).map((tr) => tr.textContent);

  it("shows the derived PAY- reference and the exact amount, not the raw reference / display text", () => {
    render(<EPaymentsTable orders={orders} />);
    expect(screen.getByText("PAY-555551")).toBeInTheDocument();
    expect(screen.queryByText(ID)).not.toBeInTheDocument();
    expect(screen.getByText("₹12,34,567.89")).toBeInTheDocument();
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
    expect(screen.getByText("EFT-77")).toBeInTheDocument();
  });

  it("has exactly the rows (and the row links) the Payments register has for the same data", () => {
    const reg = render(<PaymentsTable payments={orders} />);
    const registerRows = bodyRows(reg.container);
    const registerLinks = screen.getAllByRole("link", { name: /Open/i }).map((a) => a.getAttribute("href"));
    reg.unmount();
    const ep = render(<EPaymentsTable orders={orders} />);
    expect(bodyRows(ep.container)).toEqual(registerRows);
    expect(screen.getAllByRole("link", { name: /Open/i }).map((a) => a.getAttribute("href"))).toEqual(registerLinks);
    expect(registerLinks).toEqual([`/finance/payments/${ID}`, "/finance/payments/11111111-2222-4333-8444-555555555552"]);
  });

  it("has the register's Pending / Released tabs, which filter the rows", () => {
    const { container } = render(<EPaymentsTable orders={orders} />);
    expect(bodyRows(container)).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: "Released" }));
    const rows = bodyRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Acme Supplies");
    fireEvent.click(screen.getByRole("tab", { name: "Pending" }));
    expect(bodyRows(container)).toEqual([expect.stringContaining("Beta Traders")]);
  });

  it("keeps this screen's own empty state and search label", () => {
    render(<EPaymentsTable orders={[]} />);
    expect(screen.getByText("No payment orders")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search payment orders…")).toBeInTheDocument();
  });

  it("keeps this screen's audited CSV export (the register itself has none)", () => {
    render(<EPaymentsTable orders={orders} />);
    expect(screen.getByRole("button", { name: /CSV/ })).toBeInTheDocument();
  });
});

describe("PaymentsTable keeps its own defaults when used as the Payments register", () => {
  it("uses the register title, search label and the DataTable empty state", () => {
    render(<PaymentsTable payments={[]} />);
    expect(screen.getByText("Payments register")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search payments…")).toBeInTheDocument();
    expect(screen.getByText("No records found")).toBeInTheDocument();
    expect(screen.queryByText(/CSV/)).not.toBeInTheDocument();
  });
});
