import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import TalentPoolPage from "./page";

function candidate(overrides: Record<string, unknown>) {
  return {
    id: "c1",
    applicantName: "Ravi Kumar",
    email: "ravi@example.com",
    mobile: null,
    qualification: "B.Tech",
    experienceYears: 3,
    skills: ["Excel", "Tally"],
    source: "public_portal",
    stage: "applied",
    appliedAt: "2026-08-12T11:17:30.030Z",
    ...overrides,
  };
}

describe("TalentPoolPage (HR-A deep-verify)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders a candidate row using the real /talent-pool response field names", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [candidate({})], source: "api" });

    const ui = await TalentPoolPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    expect(screen.getByText("ravi@example.com")).toBeInTheDocument();
    expect(screen.getByText("Excel, Tally")).toBeInTheDocument();
    expect(screen.getByText("3 yr")).toBeInTheDocument();
  });

  it("shows the — placeholder for a candidate whose skills is an empty array (HR-A finding: real seed data has skills=[] as well as skills=null; only null was handled before)", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [candidate({ id: "c2", applicantName: "No Skills Person", skills: [] })],
      source: "api",
    });

    const ui = await TalentPoolPage({ searchParams: {} });
    render(ui);

    const row = screen.getByText("No Skills Person").closest("tr") as HTMLElement;
    expect(row).toBeTruthy();
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("shows the same — placeholder for a candidate whose skills is null (no regression)", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [candidate({ id: "c3", applicantName: "Null Skills Person", skills: null })],
      source: "api",
    });

    const ui = await TalentPoolPage({ searchParams: {} });
    render(ui);

    const row = screen.getByText("Null Skills Person").closest("tr") as HTMLElement;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("shows the empty state when there are no candidates", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await TalentPoolPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("No candidates found")).toBeInTheDocument();
  });

  it("shows the data-source badge when the fetch fails", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await TalentPoolPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
