import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test-utils/intl-render";

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

describe("ServiceRequestsTable — GAP-CRM-SERVICE-REQUESTS-03 (owner + overdue)", () => {
  const past = "2000-01-01T00:00:00.000Z";
  const future = "2999-01-01T00:00:00.000Z";

  it("shows an Overdue pill for an open request whose due date has passed", () => {
    renderTable({
      requests: [{ ...rows[0], id: "sr-od", status: "open", dueAt: past }],
    });
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("does NOT show Overdue for a resolved request even with a past due date", () => {
    renderTable({
      requests: [{ ...rows[0], id: "sr-res", status: "resolved", dueAt: past }],
    });
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("does NOT show Overdue when the due date is still in the future", () => {
    renderTable({
      requests: [{ ...rows[0], id: "sr-fut", status: "open", dueAt: future }],
    });
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("shows ownership status rather than a raw uuid", () => {
    renderTable({
      requests: [
        { ...rows[0], id: "sr-owned", assignedTo: "11111111-2222-4333-8444-555566667777" },
        { ...rows[0], id: "sr-unowned", assignedTo: null },
      ],
    });
    expect(screen.getByText("Assigned")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(
      screen.queryByText("11111111-2222-4333-8444-555566667777"),
    ).not.toBeInTheDocument();
  });
});

describe("ServiceRequestsTable — GAP-CRM-SERVICE-REQUESTS-04 (priority distinct)", () => {
  it("renders Normal and Low as distinct, labelled badges", () => {
    const { container } = renderTable({
      requests: [
        { ...rows[0], id: "sr-n", priority: "normal" },
        { ...rows[0], id: "sr-l", priority: "low" },
      ],
    });
    expect(screen.getByText("Normal")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
    // Low is an outlined (transparent) chip; Normal is a filled neutral chip —
    // their backgrounds must differ so they are not colour-identical.
    const normal = screen.getByText("Normal");
    const low = screen.getByText("Low");
    expect(normal.getAttribute("style")).not.toEqual(low.getAttribute("style"));
    expect(low.getAttribute("style")).toContain("transparent");
    void container;
  });
});
