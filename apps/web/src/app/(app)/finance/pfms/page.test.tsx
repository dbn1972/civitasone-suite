import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
