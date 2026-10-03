import { describe, it, expect, vi, beforeEach } from "vitest";
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
