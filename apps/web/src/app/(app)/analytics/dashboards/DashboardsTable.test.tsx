import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { useSeededResource } from "@/lib/sync/resource";
import { DashboardsTable } from "./DashboardsTable";
import type { AnalyticsDashboardRow } from "../_data";

const mockedHook = vi.mocked(useSeededResource);

function seed(rows: AnalyticsDashboardRow[]) {
  mockedHook.mockReturnValue({
    data: rows,
    provenance: "live",
    offline: false,
    cachedAt: null,
    fromCache: false,
  } as unknown as ReturnType<typeof useSeededResource>);
}

const row: AnalyticsDashboardRow = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Budget Overview",
  description: "Quarterly",
  status: "active",
  visibility: "shared",
  version: 3,
  ownerId: "22222222-2222-2222-2222-222222222222",
};

describe("DashboardsTable", () => {
  beforeEach(() => mockedHook.mockReset());

  it("GAP-ANALYTICS-DASHBOARDS-01: links each row to its detail page", () => {
    seed([row]);
    render(<DashboardsTable dashboards={[row]} source="api" />);
    const link = screen.getByRole("link", { name: /Budget Overview/i });
    expect(link).toHaveAttribute("href", `/analytics/dashboards/${row.id}`);
  });

  it("GAP-ANALYTICS-DASHBOARDS-03: shows the owner (shortened), not a dropped field", () => {
    seed([row]);
    render(<DashboardsTable dashboards={[row]} source="api" />);
    expect(screen.getByText("22222222")).toBeInTheDocument();
  });

  it("GAP-ANALYTICS-DASHBOARDS-03: owner shows '—' when unknown", () => {
    seed([{ ...row, ownerId: null }]);
    render(<DashboardsTable dashboards={[{ ...row, ownerId: null }]} source="api" />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("GAP-ANALYTICS-DASHBOARDS-04: visibility pill is humanized ('Shared'), not SHOUTING, and version is v-prefixed", () => {
    seed([row]);
    render(<DashboardsTable dashboards={[row]} source="api" />);
    expect(screen.getByText("Shared")).toBeInTheDocument();
    expect(screen.queryByText("SHARED")).not.toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
  });
});
