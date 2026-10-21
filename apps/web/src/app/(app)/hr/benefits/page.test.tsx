import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import BenefitsPage from "./page";

async function renderPage() {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{await BenefitsPage()}</NextIntlClientProvider>);
}

describe("BenefitsPage load states (GAP-HR-BENEFITS-03)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("a 403 shows 'Access restricted' with the backend reason and NO Retry button, plus the personal-data note", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 403, errorMessage: "requires one of: hr_admin, employee" });
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry|try again/i })).toBeNull();
    expect(screen.getByText(/personal to each employee/i)).toBeInTheDocument();
  });

  it("a 500 keeps the generic retryable error and does not claim a permission problem", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).toBeNull();
    expect(screen.queryByText(/personal to each employee/i)).toBeNull();
  });

  it("a healthy empty list is an empty state, not an error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).toBeNull();
    expect(screen.queryByText(/personal to each employee/i)).toBeNull();
  });
});

// GAP-HR-BENEFITS-01: the endpoint returns only the CALLER'S elections, so the
// copy must say so, and the list must not be truncated (the route used to end in
// LIMIT 10). These run the page's REAL mapResponse over API-shaped rows.
function election(i: number) {
  const start = 2014 + i;
  const fy = `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  return {
    id: `el-${i}`, plan_name: `Flex Basket ${fy}`, fy,
    elections: [{ component: "hra", electedMinor: 1000 }], total_elected_minor: 1000, status: "active",
  };
}

describe("BenefitsPage personal-list scope and full history (GAP-HR-BENEFITS-01)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  function realLoader(rows: ReturnType<typeof election>[]) {
    fetchJsonMock.mockImplementation(async (url: string, _fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) => ({
      data: opts.mapResponse({ data: url.includes("/plans") ? [] : rows, meta: { total: rows.length, limit: 200, offset: 0 } }),
      source: "api",
    }));
  }

  it("with 11 elections seeded, all 11 are reachable on the page and counted", async () => {
    const rows = Array.from({ length: 11 }, (_, i) => election(i));
    realLoader(rows);
    await renderPage();
    for (const r of rows) {
      expect(screen.getByText(r.plan_name)).toBeInTheDocument();
    }
    // The oldest two are exactly what the old LIMIT 10 dropped.
    expect(screen.getByText("Flex Basket 2014-15")).toBeInTheDocument();
    expect(screen.getByText("Flex Basket 2015-16")).toBeInTheDocument();
    // The "My Elections" tile counts all of them.
    const tile = screen.getByText("My Elections").closest(".stat, [class*='stat']") ?? screen.getByText("My Elections").parentElement!;
    expect(tile.textContent).toMatch(/11/);
  });

  it("the copy says these are MY elections, never an organisation-wide enrolment register", async () => {
    realLoader([election(0)]);
    await renderPage();
    // page title (h1) and the card title both read "My Benefit Elections"
    expect(screen.getAllByRole("heading", { name: "My Benefit Elections" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Total Enrollments/i)).toBeNull();
    expect(screen.queryByText(/Enrollment register/i)).toBeNull();
  });

  it("neither locale file still carries the register wording for this personal list", () => {
    const hi = hiMessages.benefits;
    const en = enMessages.benefits;
    expect(JSON.stringify(en)).not.toMatch(/Total Enrollments|Enrollment register/i);
    // hi used to say "कुल नामांकन" (Total enrolments) / "लाभ नामांकन" (Benefit enrolment)
    expect(hi.statTotalEnrollmentsLabel).not.toContain("कुल नामांकन");
    expect(hi.title).not.toBe("लाभ नामांकन");
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(hi.component).sort()).toEqual(Object.keys(en.component).sort());
  });
});
