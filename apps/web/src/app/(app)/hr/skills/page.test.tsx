import { describe, it, expect, vi } from "vitest";

// W1 SF-09b: the page now opens with requireAnyRole(<its backend tier>). Role
// admission is covered in ../pageGates.test.tsx; these suites test rendering,
// so the gate is a no-op here (everything else in roleGuard stays real).
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  requireAnyRole: () => {},
}));
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import SkillsPage from "./page";

async function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await SkillsPage()}
    </NextIntlClientProvider>,
  );
}

function row(overrides: Partial<Record<string, string>> = {}) {
  return {
    id: "sa1",
    employee: "Priya Nair",
    department: "Finance",
    skill: "Drizzle ORM",
    category: "Technical",
    proficiency: "advanced",
    assessedBy: "HR Admin",
    lastAssessed: "2026-01-01",
    ...overrides,
  };
}

describe("SkillsPage", () => {
  // GAP-HR-SKILLS-05: a failed fetch previously rendered 0 on every stat
  // card, indistinguishable from "zero skill records exist".
  it("shows '—' on every stat card when the fetch errors, not 0", async () => {
    fetchJsonMock.mockResolvedValue({ data: { items: [], total: 0, hasMore: false }, source: "error" });
    await renderPage();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("counts 'expert' and 'advanced' separately now that level 3 is reachable (GAP-HR-SKILLS-03)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: {
        items: [
          row({ id: "sa1", employee: "Priya Nair", proficiency: "advanced" }),
          row({ id: "sa2", employee: "Arjun Rao", proficiency: "expert" }),
        ],
        total: 2,
        hasMore: false,
      },
      source: "api",
    });
    await renderPage();
    // statExpert only counts "expert" now (was expert+advanced, making
    // "advanced" indistinguishable from "expert" in the stat card) -- and its
    // label says so: "Expert", not "Expert / Advanced".
    const expertTile = screen.getByText("Expert", { selector: ".lab" }).closest(".stat");
    expect(expertTile).toHaveTextContent("1");
    expect(screen.queryByText("Expert / Advanced")).not.toBeInTheDocument();
    expect(screen.getByText("Skill Records").closest(".stat")).toHaveTextContent("2");
  });

  it("names the single baseline every skill is measured against in the legend (GAP-HR-SKILLS-03)", async () => {
    fetchJsonMock.mockResolvedValue({ data: { items: [row()], total: 1, hasMore: false }, source: "api" });
    await renderPage();
    expect(screen.getByText("Baseline for all skills: Advanced")).toBeInTheDocument();
    expect(screen.getByText("At / above baseline")).toBeInTheDocument();
    expect(screen.queryByText(/At \/ above requirement/)).not.toBeInTheDocument();
  });

  // GAP-HR-SKILLS-06: the backend can now report more rows than it returned;
  // the page must say so instead of silently showing a partial matrix.
  it("shows a truncation notice when the backend reports hasMore", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { items: [row()], total: 800, hasMore: true },
      source: "api",
    });
    await renderPage();
    expect(screen.getByText("Showing 1 of 800 skill records.")).toBeInTheDocument();
  });

  it("does not show a truncation notice when everything fit", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { items: [row()], total: 1, hasMore: false },
      source: "api",
    });
    await renderPage();
    expect(screen.queryByText(/Showing \d+ of \d+/)).not.toBeInTheDocument();
  });
});
