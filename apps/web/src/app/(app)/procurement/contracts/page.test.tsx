import { describe, it, expect, vi, beforeEach } from "vitest";
// intl-render wraps the output in an English provider: the register table is a client component.
import { render, screen } from "@/test-utils/intl-render";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import { createTranslator } from "next-intl";
import en from "@/messages/en.json";

// Server component: resolve namespaced keys against the real en messages.
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => createTranslator({ locale: "en", messages: en as never, namespace: ns as never }),
}));

import ProcurementContractsPage from "./page";

function route(opts: {
  contracts: { data: unknown; source: "api" | "error" };
  vendors?: { data: unknown; source: "api" | "error" };
}) {
  fetchJsonMock.mockImplementation((path: unknown, _empty: unknown, options?: { mapResponse?: (p: unknown) => unknown }) => {
    const p = typeof path === "string" ? path : "";
    if (p.includes("/contract/contracts")) {
      // Apply the real mapper so the loader output matches production.
      const mapped = options?.mapResponse ? options.mapResponse(opts.contracts.data) : opts.contracts.data;
      return Promise.resolve({ data: opts.contracts.source === "error" ? [] : mapped, source: opts.contracts.source });
    }
    if (p.includes("/procurement/vendors")) {
      const v = opts.vendors ?? { data: [], source: "api" as const };
      const mapped = options?.mapResponse ? options.mapResponse(v.data) : v.data;
      return Promise.resolve({ data: v.source === "error" ? [] : mapped, source: v.source });
    }
    return Promise.resolve({ data: [], source: "api" });
  });
}

const CONTRACTS = {
  data: { data: [{ id: "c1", title: "Annual AMC", vendorId: "v1", contractNo: "CON-1", status: "active" }] },
  source: "api" as const,
};
const VENDORS = {
  data: { data: [{ id: "v1", vendorCode: "V1", name: "Acme Supplies", category: "IT", empanelmentStatus: "empanelled" }] },
  source: "api" as const,
};

describe("ProcurementContractsPage (GAP-PROCUREMENT-CONTRACTS-01/02/03/04)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("GAP-CONTRACTS-01: resolves vendorId to the vendor name (never the raw id)", async () => {
    route({ contracts: CONTRACTS, vendors: VENDORS });
    render(await ProcurementContractsPage({}));
    expect(screen.getByText("Acme Supplies")).toBeInTheDocument();
    expect(screen.queryByText("v1")).not.toBeInTheDocument();
  });

  it("GAP-CONTRACTS-01: unknown vendorId shows a friendly fallback, not the raw id", async () => {
    route({
      contracts: { data: { data: [{ id: "c2", title: "T", vendorId: "ghost", contractNo: "CON-2", status: "active" }] }, source: "api" },
      vendors: VENDORS,
    });
    render(await ProcurementContractsPage({}));
    expect(screen.getByText("Unknown vendor")).toBeInTheDocument();
    expect(screen.queryByText("ghost")).not.toBeInTheDocument();
  });

  it("GAP-CONTRACTS-02: no 'Templates' dead-end link remains", async () => {
    route({ contracts: CONTRACTS, vendors: VENDORS });
    render(await ProcurementContractsPage({}));
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs.some((h) => h?.includes("template=1"))).toBe(false);
    expect(screen.queryByText("Templates")).not.toBeInTheDocument();
  });

  it("GAP-CONTRACTS-03: contract rows link to the detail route /contracts/[id]", async () => {
    route({ contracts: CONTRACTS, vendors: VENDORS });
    render(await ProcurementContractsPage({}));
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/contracts/c1");
  });

  it("GAP-CONTRACTS-04: on a failed load, stats show '—' and a retry error state (not 0s)", async () => {
    route({ contracts: { data: {}, source: "error" }, vendors: VENDORS });
    render(await ProcurementContractsPage({}));
    expect(screen.getByText("Total Contracts").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Active").closest(".stat")).toHaveTextContent("—");
    // RefreshErrorState renders a Try again action (button).
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
  });

  it("GAP-CONTRACTS-01: a vendors fetch failure does not blank the contracts list", async () => {
    route({ contracts: CONTRACTS, vendors: { data: {}, source: "error" } });
    render(await ProcurementContractsPage({}));
    // Contract still shown; vendor falls back.
    expect(screen.getByText("Annual AMC")).toBeInTheDocument();
    expect(screen.getByText("Unknown vendor")).toBeInTheDocument();
  });

  const RICH = {
    data: {
      data: [
        { id: "c1", title: "Annual AMC", vendorId: "v1", contractNo: "CON-1", status: "expiring", expiry: "2026-11-05", valueMinor: "1250000", poRef: "procurement_po:33333333-3333-4333-8333-333333333333" },
        { id: "c2", title: "Cleaning", vendorId: "v1", contractNo: "CON-2", status: "active", expiry: "2027-03-01", valueMinor: "50000", poRef: "FREE-TEXT-PO" },
        { id: "c3", title: "No extras", vendorId: "v1", contractNo: "CON-3", status: "active" },
      ],
    },
    source: "api" as const,
  };

  it("GAP-CONTRACTS-03: shows Expiry and Value columns (paise formatted) and a dash when absent", async () => {
    route({ contracts: RICH, vendors: VENDORS });
    render(await ProcurementContractsPage({}));
    expect(screen.getByRole("columnheader", { name: /Expires/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Value/i })).toBeInTheDocument();
    const row1 = screen.getByText("Annual AMC").closest("tr")!;
    expect(row1).toHaveTextContent("05 Nov 2026");
    expect(row1).toHaveTextContent("12,500.00");
    const row3 = screen.getByText("No extras").closest("tr")!;
    expect(row3).toHaveTextContent("—");
  });

  it("GAP-CONTRACTS-03: the Expiring Soon card links to ?status=expiring and the filter narrows the list", async () => {
    route({ contracts: RICH, vendors: VENDORS });
    render(await ProcurementContractsPage({ searchParams: { status: "expiring" } }));
    expect(screen.getByText("Expiring Soon").closest("a")).toHaveAttribute("href", "/procurement/contracts?status=expiring");
    expect(screen.getByText("Annual AMC")).toBeInTheDocument();
    expect(screen.queryByText("Cleaning")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/expiring/i);
  });

  it("GAP-CONTRACTS-05: a uuid poRef links to the order; free text is shown as typed", async () => {
    route({ contracts: RICH, vendors: VENDORS });
    render(await ProcurementContractsPage({}));
    expect(screen.getByRole("columnheader", { name: "PO" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "View PO" });
    expect(link).toHaveAttribute("href", "/procurement/orders/33333333-3333-4333-8333-333333333333");
    expect(screen.getByText("FREE-TEXT-PO")).toBeInTheDocument();
  });
});
