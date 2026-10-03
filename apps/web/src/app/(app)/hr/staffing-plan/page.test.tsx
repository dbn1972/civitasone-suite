import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import StaffingPlanPage from "./page";
import { mapRows, departmentCadreLabel } from "./_data";

async function renderPage(searchParams?: { year?: string }) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await StaffingPlanPage({ searchParams })}
    </NextIntlClientProvider>,
  );
}

/** Raw-API shape (pre-mapRows), for the pure-function tests below. */
function apiRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p1",
    department: "Finance" as string | null,
    cadre: "Clerk",
    planYear: 2025,
    sanctionedPosts: 80,
    filled: 70,
    vacant: 10,
    fillPercentage: 87.5 as number | string,
    lastReview: "2025-03-04T10:00:00Z" as string | null,
    status: "approved",
    ...overrides,
  };
}

/** Post-mapRows shape (what a mocked fetchJson resolves to directly, since
 * mocking fetchJson bypasses getData's own mapResponse/mapRows call). */
function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p1",
    departmentCadre: "Finance / Clerk",
    planYear: 2025,
    sanctionedPosts: 80,
    filled: 70,
    vacant: 10,
    fillPercentage: "87.5%",
    lastReview: "04 Mar 2025",
    status: "approved",
    ...overrides,
  };
}

describe("mapRows / departmentCadreLabel — pure-function tests (GAP-HR-STAFFING-PLAN-01/02/03)", () => {
  it("coerces a string fillPercentage to a number before formatting (GAP-01)", () => {
    const [mapped] = mapRows([apiRow({ fillPercentage: "87.5" })]);
    expect(mapped.fillPercentage).toBe("87.5%");
  });

  it("formats a zero (number) fillPercentage as '0.0%', not '—' (GAP-01)", () => {
    const [mapped] = mapRows([apiRow({ fillPercentage: 0 })]);
    expect(mapped.fillPercentage).toBe("0.0%");
  });

  it("formats lastReview as an Indian-style date, no raw ISO string left (GAP-02)", () => {
    const [mapped] = mapRows([apiRow({ lastReview: "2026-03-04T10:00:00Z" })]);
    expect(mapped.lastReview).toBe("04 Mar 2026");
  });

  it("shows '—' for lastReview when null (GAP-02)", () => {
    const [mapped] = mapRows([apiRow({ lastReview: null })]);
    expect(mapped.lastReview).toBe("—");
  });

  it("combines department and cadre when both exist and differ (GAP-03)", () => {
    expect(departmentCadreLabel("Finance", "Clerk")).toBe("Finance / Clerk");
  });

  it("falls back to cadre alone when department is null (GAP-03)", () => {
    expect(departmentCadreLabel(null, "Constable")).toBe("Constable");
  });

  it("falls back to cadre alone when department equals cadre (avoids a redundant 'X / X' label)", () => {
    expect(departmentCadreLabel("Clerk", "Clerk")).toBe("Clerk");
  });

  it("gives two different cadres in the same department distinguishable combined labels (GAP-03 acceptance)", () => {
    const mapped = mapRows([
      apiRow({ id: "p1", department: "Finance", cadre: "Clerk" }),
      apiRow({ id: "p2", department: "Finance", cadre: "Officer" }),
    ]);
    expect(mapped[0].departmentCadre).toBe("Finance / Clerk");
    expect(mapped[1].departmentCadre).toBe("Finance / Officer");
    expect(mapped[0].departmentCadre).not.toBe(mapped[1].departmentCadre);
  });
});

describe("StaffingPlanPage — role gating (GAP-HR-STAFFING-PLAN-04)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({
      data: { items: [row()], planYear: 2025, availableYears: [2025] },
      source: "api",
    });
  });

  it("shows PermissionDenied, without even fetching, for a role the /hr layout admits but this page's backend does not (e.g. manager)", async () => {
    mockRoles = ["manager"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders the table for hr_admin", async () => {
    mockRoles = ["hr_admin"];
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    expect(screen.getByText("Finance / Clerk")).toBeInTheDocument();
  });
});

describe("StaffingPlanPage — 403 vs network error (GAP-HR-STAFFING-PLAN-04)", () => {
  beforeEach(() => {
    mockRoles = ["hr_admin"];
    fetchJsonMock.mockReset();
  });

  it("shows an honest access-restricted message on a live 403 from the backend, not a generic retry button", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { items: [], planYear: null, availableYears: [] },
      source: "error",
      status: 403,
      errorMessage: "requires one of: hr_admin, super_admin, hr_officer",
    });
    await renderPage();
    expect(screen.getByText(/requires one of/i)).toBeInTheDocument();
    // Scoped to the card body's own error state, not the top DataSourceBadge
    // pill (which legitimately shows its own "Couldn't load" wording for
    // ANY source:"error" case, 403 included -- that pill is unrelated to
    // GAP-04's card-body distinction).
    expect(screen.queryByText("Try again")).not.toBeInTheDocument();
  });

  it("shows a generic retry state on a genuine network/server error, not an access-restricted message", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { items: [], planYear: null, availableYears: [] },
      source: "error",
      status: 500,
    });
    await renderPage();
    expect(screen.getByText("Try again")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
  });
});

describe("StaffingPlanPage — overall fill rate (GAP-HR-STAFFING-PLAN-05)", () => {
  beforeEach(() => {
    mockRoles = ["hr_admin"];
    fetchJsonMock.mockReset();
  });

  it("shows '—' for the overall fill rate stat when total sanctioned is 0, not '0%'", async () => {
    fetchJsonMock.mockResolvedValue({
      data: {
        items: [row({ sanctionedPosts: 0, filled: 0, vacant: 0 })],
        planYear: 2025,
        availableYears: [2025],
      },
      source: "api",
    });
    await renderPage();
    expect(screen.getByText("Fill Rate %").closest(".stat")).toHaveTextContent("—");
  });

  it("shows a real percentage for the overall fill rate when sanctioned > 0", async () => {
    fetchJsonMock.mockResolvedValue({
      data: {
        items: [row({ sanctionedPosts: 80, filled: 70 })],
        planYear: 2025,
        availableYears: [2025],
      },
      source: "api",
    });
    await renderPage();
    expect(screen.getByText("Fill Rate %").closest(".stat")).toHaveTextContent("88%");
  });
});

describe("StaffingPlanPage — plan year column + selector (GAP-HR-STAFFING-PLAN-04)", () => {
  beforeEach(() => {
    mockRoles = ["hr_admin"];
    fetchJsonMock.mockReset();
  });

  it("shows a year selector populated with availableYears", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { items: [row({ planYear: 2025 })], planYear: 2025, availableYears: [2025, 2024] },
      source: "api",
    });
    await renderPage();
    expect(screen.getByLabelText("Plan Year")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2024" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2025" })).toBeInTheDocument();
  });

  it("does not show a year selector when there is no data for any year yet", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { items: [], planYear: null, availableYears: [] },
      source: "api",
    });
    await renderPage();
    expect(screen.queryByLabelText("Plan Year")).not.toBeInTheDocument();
  });
});

describe("StaffingPlanPage — vacancy over-threshold alert (GAP-HR-WORKFORCE-STAFFING-PLAN-01)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); mockRoles = ["hr_admin"]; });

  it("alerts for 100 sanctioned / 85 filled (count 1), flags that row, and not the 95-filled one", async () => {
    fetchJsonMock.mockResolvedValue({
      data: {
        items: [
          row({ id: "a", departmentCadre: "Roads / Engineer", sanctionedPosts: 100, filled: 85, vacant: 15 }),
          row({ id: "b", departmentCadre: "Parks / Clerk", sanctionedPosts: 100, filled: 95, vacant: 5 }),
        ],
        planYear: 2025, availableYears: [2025],
      },
      source: "api",
    });
    await renderPage();
    expect(screen.getByRole("alert").textContent?.trim()).toBe("1 department or cadre has vacancies above 10% of sanctioned strength.");
    expect(screen.getAllByText(/over 10% vacant/i)).toHaveLength(1);
  });

  it("shows no alert when no row is over the threshold", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { items: [row({ sanctionedPosts: 100, filled: 95, vacant: 5 })], planYear: 2025, availableYears: [2025] },
      source: "api",
    });
    await renderPage();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
