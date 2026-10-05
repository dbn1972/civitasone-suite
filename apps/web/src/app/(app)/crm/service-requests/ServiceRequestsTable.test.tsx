import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/crm/service-requests",
  useSearchParams: () => new URLSearchParams("page=2"),
}));

// Keep the seeded-resource hook simple and deterministic in jsdom.
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown[]) => ({
    data: initial,
    provenance: "live",
    offline: false,
    cachedAt: null,
  }),
}));

import { ServiceRequestsTable } from "./ServiceRequestsTable";
import type { CrmServiceRequestRow } from "../../../_data/loaders";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function withIntl(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

const rows: CrmServiceRequestRow[] = [
  { id: "sr-1", referenceNo: "R1", citizenName: "Asha Rao", serviceType: "Birth Certificate", subject: "s", priority: "normal", status: "open", assignedTo: null, dueAt: null, createdAt: null },
];

function renderTable(props: Partial<Parameters<typeof ServiceRequestsTable>[0]> = {}) {
  return render(withIntl(
    <ServiceRequestsTable
      requests={rows}
      source="api"
      page={2}
      pageCount={9}
      total={132}
      pageSize={15}
      canExport={false}
      queryKey="page=2"
      {...props}
    />));
}

beforeEach(() => {
  replaceMock.mockReset();
});

describe("ServiceRequestsTable — GAP-CRM-SERVICE-REQUESTS-01 (server pager)", () => {
  it("shows the true total and page position", () => {
    renderTable();
    expect(screen.getByText(/of 132/)).toBeInTheDocument();
    expect(screen.getByText(/Page 2 of 9/)).toBeInTheDocument();
  });

  it("Next advances the page URL param", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(replaceMock).toHaveBeenCalledWith("/crm/service-requests?page=3");
  });

  it("Prev on page 2 drops the page param (back to page 1)", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /prev/i }));
    expect(replaceMock).toHaveBeenCalledWith("/crm/service-requests");
  });
});

describe("ServiceRequestsTable — GAP-CRM-SERVICE-REQUESTS-02 (export gate)", () => {
  it("hides the CSV export button for a non-privileged viewer", () => {
    renderTable({ canExport: false });
    expect(screen.queryByRole("button", { name: /csv/i })).not.toBeInTheDocument();
  });

  it("shows the CSV export button for a privileged viewer", () => {
    renderTable({ canExport: true });
    expect(screen.getByRole("button", { name: /csv/i })).toBeInTheDocument();
  });
});
