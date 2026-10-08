import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import PfmsOpsConsolePage from "./page";

// UX-017: PfmsOpsConsolePage itself reads its copy through getTranslations
// (mocked centrally in vitest.setup.ts, per tranche 3), but it also renders
// <PfmsConsole> -- a "use client" component that calls useTranslations() --
// so the rendered tree still needs a real NextIntlClientProvider, same as
// any other client-component test (hr/leave/apply/ApplyLeaveForm.test.tsx).
// Unlike hr/recruitment's page.test.tsx/talent-pool/page.test.tsx (tranche 4),
// which passed unchanged because neither nests a translated client
// component, this page's PfmsConsole subtree does.
function renderPage(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PfmsOpsConsolePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the batch list and stats", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/batches")) {
        return Promise.resolve({
          data: [
            {
              id: "b1", pfmsId: "PFMS-0001", type: "salary", amountMinor: "150000000",
              agencyCode: "AG01", schemeCode: "SCH01", ddoCode: "DDO01",
              submissionStatus: "signed", signedAt: "2026-07-01T00:00:00Z",
            },
            {
              id: "b2", pfmsId: "PFMS-0002", type: "vendor", amountMinor: "50000",
              agencyCode: "AG01", schemeCode: null, ddoCode: null,
              submissionStatus: "pending", signedAt: null,
            },
          ],
          source: "api",
        });
      }
      if (path.includes("/departments")) {
        return Promise.resolve({ data: [], source: "api" });
      }
      return Promise.resolve({ data: { agencyCode: "AG01", defaultDdo: "DDO01" }, source: "api" });
    });

    const ui = await PfmsOpsConsolePage();
    renderPage(ui);

    expect(screen.getByText("PFMS Ops Console")).toBeInTheDocument();
    expect(screen.getByText("PFMS-0001")).toBeInTheDocument();
    expect(screen.getByText("PFMS-0002")).toBeInTheDocument();
  });

  it("renders an empty state when there are no batches", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/batches")) return Promise.resolve({ data: [], source: "api" });
      if (path.includes("/departments")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: null, source: "api" });
    });

    const ui = await PfmsOpsConsolePage();
    renderPage(ui);

    expect(screen.getByText("No PFMS batches yet")).toBeInTheDocument();
  });

  it("shows the data-source badge when an endpoint errors", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/batches")) return Promise.resolve({ data: [], source: "error" });
      if (path.includes("/departments")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: null, source: "api" });
    });

    const ui = await PfmsOpsConsolePage();
    renderPage(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  // GAP2-FINANCE-PFMS-08: a failed /pfms/batches read must dash the count/value
  // stats and show a retry state in the batches panel, NOT "Batches 0 /
  // Signed 0 / Pending 0 / Total ₹0.00" with an empty batch list.
  it("dashes the batch stats and shows a retry state when /pfms/batches fails", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/batches")) return Promise.resolve({ data: [], source: "error", status: 500 });
      if (path.includes("/departments") || path.includes("/bills")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: { agencyCode: "AG01", defaultDdo: "DDO01" }, source: "api" });
    });

    const ui = await PfmsOpsConsolePage();
    renderPage(ui);

    // stats are dashed, not a believable zero
    expect(screen.getByText("Signed").parentElement).toHaveTextContent("—");
    expect(screen.getByText("Pending Signature").parentElement).toHaveTextContent("—");
    expect(screen.getByText("Total Batch Value").parentElement).toHaveTextContent("—");
    expect(screen.getByText("Total Batch Value").parentElement).not.toHaveTextContent("₹0.00");
    // the batch panel shows a retry affordance, not the "no batches" empty state
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No PFMS batches yet")).not.toBeInTheDocument();
  });

  // A 403 on batches is an access-restricted state, not a retry.
  it("shows an access-restricted state (no retry) when /pfms/batches is 403", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/batches")) return Promise.resolve({ data: [], source: "error", status: 403 });
      if (path.includes("/departments") || path.includes("/bills")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: { agencyCode: "AG01", defaultDdo: "DDO01" }, source: "api" });
    });

    const ui = await PfmsOpsConsolePage();
    renderPage(ui);

    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.queryByText("No PFMS batches yet")).not.toBeInTheDocument();
  });

  // A genuine empty (200 []) still shows the empty batch list, not the error state.
  it("still shows the empty batch state for a genuine empty batches list", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/batches")) return Promise.resolve({ data: [], source: "api" });
      if (path.includes("/departments") || path.includes("/bills")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: { agencyCode: "AG01", defaultDdo: "DDO01" }, source: "api" });
    });

    const ui = await PfmsOpsConsolePage();
    renderPage(ui);

    expect(screen.getByText("No PFMS batches yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
  it("degrades the Total stat to a dash with a note when a batch amount is unreadable", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/batches")) {
        return Promise.resolve({
          data: [
            { id: "b1", pfmsId: "PFMS-0001", type: "salary", channel: "treasury_batch", amountMinor: "12.50", agencyCode: null, schemeCode: null, ddoCode: null, submissionStatus: "pending", signedAt: null },
            { id: "b2", pfmsId: "PFMS-0002", type: "salary", channel: "treasury_batch", amountMinor: "250", agencyCode: null, schemeCode: null, ddoCode: null, submissionStatus: "pending", signedAt: null },
          ],
          source: "api",
        });
      }
      if (path.includes("/departments") || path.includes("/bills")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: null, source: "api" });
    });
    const ui = await PfmsOpsConsolePage();
    renderPage(ui);
    expect(screen.getByText("PFMS-0001")).toBeInTheDocument();
    expect(screen.getByText(/1 batch has an unreadable amount/)).toBeInTheDocument();
    // the Total stat shows a dash rather than a partial, misleading sum
    expect(screen.getByText("Total Batch Value").parentElement).toHaveTextContent("—");
  });

  it("shows the real total when every amount is readable (no note)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/batches")) {
        return Promise.resolve({
          data: [{ id: "b1", pfmsId: "PFMS-0001", type: "salary", channel: "treasury_batch", amountMinor: "250", agencyCode: null, schemeCode: null, ddoCode: null, submissionStatus: "pending", signedAt: null }],
          source: "api",
        });
      }
      if (path.includes("/departments") || path.includes("/bills")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: null, source: "api" });
    });
    const ui = await PfmsOpsConsolePage();
    renderPage(ui);
    expect(screen.getAllByText("₹2.50").length).toBeGreaterThan(0);
    expect(screen.queryByText(/unreadable amount/)).not.toBeInTheDocument();
  });

  // GAP-FINANCE-PFMS-05: config.mode reaches the Payments tab banner.
  it("passes config.paymentRail / treasuryMode to the Payments tab so the banner shows before any submit", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/batches") || path.includes("/departments") || path.includes("/bills")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: { agencyCode: "AG01", defaultDdo: "D", paymentRail: "disabled", treasuryMode: "sandbox" }, source: "api" });
    });
    const ui = await PfmsOpsConsolePage();
    renderPage(ui);
    // mapResponse is bypassed by the mock, so the page must cope with the raw payload too.
    fireEvent.click(screen.getByText("Payments"));
    expect(screen.getAllByText("PFMS payments are disabled on this server").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Salary Bill" }));
    expect(screen.getAllByText("Sandbox Mode").length).toBeGreaterThan(0);
  });

  // GAP-FINANCE-PFMS-07: the bill picker pages through ALL bills (default page is 50), keeping payable ones.
  it("loads bills page by page until a short page, keeping only payable bills", async () => {
    const bill = (i: number, status: string) => ({ id: `id-${i}`, billNo: `B-${i}`, vendor: "", amount: "100", status });
    const pages: Record<string, unknown[]> = {
      "offset=0": Array.from({ length: 500 }, (_, i) => bill(i, i % 2 ? "passed" : "pending")),
      "offset=500": [bill(900, "passed"), bill(901, "paid")],
    };
    const billCalls: string[] = [];
    fetchJsonMock.mockImplementation(async (path: string, fallback: unknown, opts: { mapResponse?: (p: unknown) => unknown }) => {
      if (path.includes("/bills")) {
        billCalls.push(path);
        const key = Object.keys(pages).find((k) => path.includes(k))!;
        return { data: opts.mapResponse!({ data: pages[key] }), source: "api" };
      }
      if (path.includes("/batches") || path.includes("/departments")) return { data: [], source: "api" };
      return { data: null, source: "api" };
    });
    const ui = await PfmsOpsConsolePage();
    renderPage(ui);
    expect(billCalls).toHaveLength(2);
    expect(billCalls[1]).toContain("offset=500");
    fireEvent.click(screen.getByText("Payments"));
    fireEvent.click(screen.getByRole("tab", { name: "Payment Advice" }));
    const select = screen.getByLabelText(/^Bill \*/) as HTMLSelectElement;
    // 250 payable on page 1 + 1 payable on page 2 + the placeholder option
    expect(select.options).toHaveLength(252);
  });
});
