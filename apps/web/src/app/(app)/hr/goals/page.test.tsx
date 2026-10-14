import { describe, it, expect, vi, beforeEach } from "vitest";

// W1 SF-09b: the page now opens with requireAnyRole(<its backend tier>). Full
// role admission is covered in ../pageGates.test.tsx; here the gate honours a
// per-test session role list (everything else in roleGuard stays real).
let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  requireAnyRole: (allowed: string[]) => {
    if (!allowed.some((r) => mockRoles.includes(r))) throw new Error("REDIRECT");
  },
}));
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import GoalsPage from "./page";

const goal = (id: string, status: string, health?: string) =>
  ({ id, title: `Goal ${id}`, category: "individual", progress: 10, status, ...(health ? { health } : {}) });

function stub(goals: unknown[]) {
  fetchJsonMock.mockImplementation(async (path: string) =>
    String(path).includes("/goals") ? { data: goals, source: "api" } : { data: [], source: "api" });
}

async function renderPage() {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{await GoalsPage()}</NextIntlClientProvider>);
}

function statValue(label: string): string {
  const lab = screen.getAllByText(label).find((el) => el.classList.contains("lab"))!;
  return within(lab.parentElement as HTMLElement).getByText(/^\d+$/).textContent ?? "";
}

describe("GoalsPage health stats (GAP-HR-GOALS-04)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("counts At Risk / Behind from the server-derived health, not the stored status", async () => {
    // all three are stored as 'active' -- the old page counted every one as On Track
    stub([goal("a", "active", "on_track"), goal("b", "active", "at_risk"), goal("c", "active", "behind")]);
    await renderPage();
    expect(statValue("On Track")).toBe("1");
    expect(statValue("At Risk / Behind")).toBe("2");
  });

  it("falls back to the stored status when the service sends no health (older service)", async () => {
    stub([goal("a", "active"), goal("b", "at_risk")]);
    await renderPage();
    expect(statValue("On Track")).toBe("1");
    expect(statValue("At Risk / Behind")).toBe("1");
  });

  it("a completed goal is in neither bucket", async () => {
    stub([goal("a", "completed", "completed")]);
    await renderPage();
    expect(statValue("On Track")).toBe("0");
    expect(statValue("At Risk / Behind")).toBe("0");
  });
});

describe("GoalsPage for a dept_head (goals list 403, development plans 200)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); mockRoles = ["dept_head"]; });

  it("shows Access restricted for goals with no retry prompt, honest dashes, and still renders the dev plans", async () => {
    fetchJsonMock.mockImplementation(async (path: string) =>
      String(path).includes("/development-plans")
        ? {
            data: [{ id: "p1", employee: "Asha", title: "Leadership workshop", type: "training", plannedDate: "2026-11-01", status: "planned", priority: "high" }],
            source: "api",
          }
        : { data: [], source: "error", status: 403, errorMessage: "requires one of: hr_admin, hr_officer, manager" },
    );
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again|retry|refresh/i })).not.toBeInTheDocument();
    // stat tiles read "—", never a fabricated 0
    const lab = screen.getAllByText("On Track").find((el) => el.classList.contains("lab"))!;
    expect(within(lab.parentElement as HTMLElement).queryByText(/^\d+$/)).not.toBeInTheDocument();
    expect(within(lab.parentElement as HTMLElement).getByText("—")).toBeInTheDocument();
    // development plans unaffected
    expect(screen.getByText("Leadership workshop")).toBeInTheDocument();
  });
});
