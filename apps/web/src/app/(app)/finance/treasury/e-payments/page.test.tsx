import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const getFinanceEPayments = vi.hoisted(() => vi.fn());
vi.mock("@/app/_data/loaders", () => ({ getFinanceEPayments: (...a: unknown[]) => getFinanceEPayments(...a) }));
vi.mock("./EPaymentsTable", () => ({ EPaymentsTable: () => <div>epayments-table</div> }));

import EPaymentsPage from "./page";

describe("e-Payments page (GAP-FINANCE-TREASURY-E-PAYMENTS-01)", () => {
  it("points at the Payments register that holds the same dataset", async () => {
    getFinanceEPayments.mockResolvedValue({ data: [], source: "api" });
    render(await EPaymentsPage());
    expect(screen.getByRole("link", { name: "Open Payments register" })).toHaveAttribute("href", "/finance/payments");
  });
});
