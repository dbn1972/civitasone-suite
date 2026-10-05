import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CRMControlTower } from "@civitasone/types";

vi.mock("../../../_data/loaders", () => ({ getCrmControlTower: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./ExceptionTable", () => ({ ExceptionTable: () => <div data-testid="exceptions" /> }));

import Page from "./page";
import { getCrmControlTower } from "../../../_data/loaders";

const mocked = vi.mocked(getCrmControlTower);

const tower: CRMControlTower = {
  regions: [{ region: "South", dealCount: 2, pipelineMinor: "100000" }],
  exceptions: [],
  drillDown: { regionReport: "/crm/dashboard", ageingReport: "/crm/dashboard", accounts: "/crm/accounts" },
};

beforeEach(() => mocked.mockReset());

describe("Control tower page", () => {
  it("GAP-CRM-CONTROL-TOWER-01: no 'GIS' or 'heat map' wording (there is no map)", async () => {
    mocked.mockResolvedValue({ data: tower, source: "api" });
    render(await Page());

    expect(screen.getByText("Pipeline by region")).toBeInTheDocument();
    expect(screen.queryByText(/GIS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/heat map/i)).not.toBeInTheDocument();
  });

  it("GAP-CRM-CONTROL-TOWER-03: a feed failure keeps the title and offers Retry", async () => {
    mocked.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await Page());

    expect(screen.getByRole("heading", { name: "Executive Control Tower" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("Control tower unavailable")).not.toBeInTheDocument();
  });

  it("GAP-CRM-CONTROL-TOWER-03: a genuine empty success uses the empty state, not an error", async () => {
    mocked.mockResolvedValue({ data: null, source: "api" });
    render(await Page());

    expect(screen.getByText("Control tower unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("GAP-CRM-CONTROL-TOWER-05: labels the total as a count of items, not 'Exception volume'", async () => {
    mocked.mockResolvedValue({
      data: {
        ...tower,
        exceptions: [
          { id: "a", kind: "dormant_account", label: "Dormant", severity: "high", count: 3, href: "/crm/accounts" },
          { id: "b", kind: "aged_lead", label: "Overdue", severity: "medium", count: 2, href: "/crm/accounts" },
        ],
      },
      source: "api",
    });
    render(await Page());

    expect(screen.getByText("Open exception items")).toBeInTheDocument();
    expect(screen.queryByText("Exception volume")).not.toBeInTheDocument();
    // still the sum of category counts (3 + 2)
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});
