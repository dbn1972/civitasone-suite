import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import WorkforcePage from "./page";

const MOCK_HEADCOUNT = [
  { group_key: "Finance", count: 40 },
  { group_key: "HR", count: 12 },
];
const MOCK_RETIREMENTS = [
  { employeeId: "e1", fullName: "A", monthsLeft: 3 },
  { employeeId: "e2", fullName: "B", monthsLeft: 10 },
];

function mockWorkforceLoaders(overrides: {
  headcount?: { data: unknown; source: "api" | "error" };
  retirements?: { data: unknown; source: "api" | "error" };
}) {
  const headcount = overrides.headcount ?? { data: MOCK_HEADCOUNT, source: "api" as const };
  const retirements = overrides.retirements ?? { data: MOCK_RETIREMENTS, source: "api" as const };
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path !== "string") return Promise.resolve({ data: [], source: "api" });
    if (path.includes("/hrms/workforce/headcount")) return Promise.resolve(headcount);
    if (path.includes("/hrms/workforce/retirement-forecast")) return Promise.resolve(retirements);
    return Promise.resolve({ data: [], source: "api" });
  });
}

describe("WorkforcePage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders real stat counts when both loaders succeed", async () => {
    mockWorkforceLoaders({});
    render(await WorkforcePage());
    // totalHeadcount = 40 + 12 = 52; departments = 2 rows; retiringSoon (<=6mo) = 1
    expect(screen.getByText("statTotalHeadcount").closest(".stat")).toHaveTextContent("52");
    expect(screen.getByText("statDepartments").closest(".stat")).toHaveTextContent("2");
    expect(screen.getByText("statRetiringSoon").closest(".stat")).toHaveTextContent("1");
  });

  it("renders — for every stat, not a fabricated zero, when either loader fails", async () => {
    // Bug A / UX-013: `source` was already computed (merged across both
    // loader calls) but only wired to the DataSourceBadge -- never to the
    // stat values, so a failed load rendered raw zeroes (both loaders
    // default to `[]`, and reduce/filter over an empty array is 0).
    mockWorkforceLoaders({ headcount: { data: [], source: "error" } });
    render(await WorkforcePage());
    expect(screen.getByText("statTotalHeadcount").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("statDepartments").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("statRetiringSoon").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("statRetiring12").closest(".stat")).toHaveTextContent("—");
  });

  it("renders — when the retirement-forecast loader alone fails", async () => {
    mockWorkforceLoaders({ retirements: { data: [], source: "error" } });
    render(await WorkforcePage());
    expect(screen.getByText("statRetiringSoon").closest(".stat")).toHaveTextContent("—");
    // Headcount stats share the same combined `errored` flag, so they must
    // also read — even though the headcount loader itself succeeded.
    expect(screen.getByText("statTotalHeadcount").closest(".stat")).toHaveTextContent("—");
  });
});
