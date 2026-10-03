import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["employee"] }));
const getMyProfileMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({ getMyProfile: () => getMyProfileMock() }));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import CompetencyPage from "./page";

const COMPETENCIES = [
  { id: "c1", name: "Leadership", category: "behavioural", maxLevel: 5, certifiedLevel: 3 },
  { id: "c2", name: "Communication", category: "behavioural", maxLevel: 5, certifiedLevel: 3 },
  { id: "c3", name: "Data Analysis", category: "technical", maxLevel: 5, certifiedLevel: 4 },
];
const FRAMEWORKS = [{ id: "f1", name: "Core", status: "active" }];

function route(opts: { held?: unknown[]; heldError?: boolean }) {
  fetchJsonMock.mockImplementation(async (url: string, fallback: unknown, o?: { mapResponse?: (p: unknown) => unknown }) => {
    if (url.includes("/competency/frameworks")) return { data: o?.mapResponse?.({ data: FRAMEWORKS }), source: "api" };
    if (url.includes("/competency/competencies")) return { data: o?.mapResponse?.({ data: COMPETENCIES }), source: "api" };
    if (url.includes("/employees/")) {
      if (opts.heldError) return { data: fallback, source: "error", status: 500 };
      return { data: o?.mapResponse?.(opts.held ?? []), source: "api" };
    }
    return { data: fallback, source: "api" };
  });
}
async function renderPage() {
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{await CompetencyPage()}</NextIntlClientProvider>);
}

describe("CompetencyPage radar (GAP-HR-COMPETENCY-01)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); getMyProfileMock.mockReset(); getMyProfileMock.mockResolvedValue({ data: { id: "emp-1" }, source: "api" }); });

  it("never shows sample data: no 'sample' badge or illustrative copy anywhere", async () => {
    route({ held: [{ competencyId: "c1", currentLevel: 2 }, { competencyId: "c2", currentLevel: 4 }, { competencyId: "c3", currentLevel: 3 }] });
    await renderPage();
    expect(screen.queryByText(/sample data/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/illustrative/i)).not.toBeInTheDocument();
  });

  it("plots the viewer's own recorded levels (read from their profile endpoint)", async () => {
    route({ held: [{ competencyId: "c1", currentLevel: 2 }, { competencyId: "c2", currentLevel: 4 }, { competencyId: "c3", currentLevel: 3 }] });
    await renderPage();
    expect(fetchJsonMock.mock.calls.some(([u]) => String(u).endsWith("/competency/employees/emp-1/profile"))).toBe(true);
    expect(screen.getByText("My competency profile")).toBeInTheDocument();
    // the chart's accessible data table lists the real competencies with the real held level
    const row = screen.getAllByRole("row").find((r) => r.textContent?.includes("Communication") && r.textContent?.includes("4"));
    expect(row).toBeTruthy();
  });

  it("says so honestly when fewer than three levels are recorded", async () => {
    route({ held: [{ competencyId: "c1", currentLevel: 2 }] });
    await renderPage();
    expect(screen.getByText("Not enough recorded competencies")).toBeInTheDocument();
  });

  it("says so honestly when the session is not linked to an employee record", async () => {
    getMyProfileMock.mockResolvedValue({ data: null, source: "api", status: 404 });
    route({});
    await renderPage();
    expect(screen.getByText("No employee profile linked")).toBeInTheDocument();
    expect(fetchJsonMock.mock.calls.some(([u]) => String(u).includes("/employees/"))).toBe(false);
  });

  it("a failed profile fetch is an error state, not an empty chart", async () => {
    route({ heldError: true });
    await renderPage();
    expect(screen.queryByText("Not enough recorded competencies")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
