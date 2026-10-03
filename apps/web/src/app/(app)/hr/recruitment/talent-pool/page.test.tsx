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

const pool = (candidates: unknown[], total = candidates.length) => ({ candidates, total });

describe("TalentPoolPage (HR-A deep-verify)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders a candidate row using the real /talent-pool response field names", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: pool([candidate({})]), source: "api" });

    const ui = await TalentPoolPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    // GAP-RECRUITMENT-TALENT-POOL-02: the full address must never be rendered or exported.
    expect(screen.getByText("r***@e***.com")).toBeInTheDocument();
    expect(screen.queryByText("ravi@example.com")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /export|csv/i })).not.toBeInTheDocument();
    expect(screen.getByText("Excel, Tally")).toBeInTheDocument();
    // GAP-RECRUITMENT-TALENT-POOL-06: pluralised like the vacancy page ("3 yrs").
    expect(screen.getByText("3 yrs")).toBeInTheDocument();
  });

  it("shows the — placeholder for a candidate whose skills is an empty array (HR-A finding: real seed data has skills=[] as well as skills=null; only null was handled before)", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: pool([candidate({ id: "c2", applicantName: "No Skills Person", skills: [] })]),
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
      data: pool([candidate({ id: "c3", applicantName: "Null Skills Person", skills: null })]),
      source: "api",
    });

    const ui = await TalentPoolPage({ searchParams: {} });
    render(ui);

    const row = screen.getByText("Null Skills Person").closest("tr") as HTMLElement;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("shows the empty state when there are no candidates", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: pool([]), source: "api" });

    const ui = await TalentPoolPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("No candidates found")).toBeInTheDocument();
  });

  it("shows the data-source badge when the fetch fails for a reason other than a permission denial", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: pool([]), source: "error" });

    const ui = await TalentPoolPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  // Manager-role finding: GET /v1/hrms/talent-pool is HR-only (HR_ROLES in
  // routes.ts) — a manager role gets a real, permanent 403, not a transient
  // failure. Before this fix the page couldn't tell the two apart (both are
  // source:"error") and showed the generic "Couldn't load, try again" state
  // for a request that will never succeed no matter how many times it's
  // retried.
  it("shows an honest access-restricted state, not the generic retry-suggesting error, when the fetch 403s", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: pool([]), source: "error", status: 403 });

    const ui = await TalentPoolPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(screen.getByText(/You don't have permission to do this\. Ask your administrator if you need access\./)).toBeInTheDocument();
    // Must NOT suggest retrying — retrying a real 403 never succeeds.
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
    // None of the (meaningless-with-zero-access) stat tiles or search form render.
    expect(screen.queryByText("No candidates found")).not.toBeInTheDocument();
  });

  // GAP-RECRUITMENT-TALENT-POOL-01
  it("does not show an always-zero 'Active Stages' card and states the pool scope (rejected/withdrawn/not selected)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: pool([candidate({ stage: "rejected" })]), source: "api" });
    render(await TalentPoolPage({ searchParams: {} }));
    expect(screen.queryByText("Active Stages")).not.toBeInTheDocument();
    expect(screen.getByText(/previously rejected, withdrawn or not selected/i)).toBeInTheDocument();
    expect(screen.queryByText(/All candidates who applied/i)).not.toBeInTheDocument();
  });

  it("the headline count is the server total across all pages, not the rows on this page", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: pool([candidate({})], 137), source: "api" });
    render(await TalentPoolPage({ searchParams: {} }));
    expect(screen.getByText("Candidates (137)")).toBeInTheDocument();
    expect(screen.getByText("Showing 1–1 of 137")).toBeInTheDocument();
  });

  // GAP-RECRUITMENT-TALENT-POOL-03
  it("links a candidate row to their application detail page", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: pool([candidate({ id: "app-9", jobOpeningId: "job-3" })]),
      source: "api",
    });
    render(await TalentPoolPage({ searchParams: {} }));
    const link = screen.getByRole("link", { name: /Ravi Kumar/i });
    expect(link).toHaveAttribute("href", "/hr/recruitment/job-3/applications/app-9");
  });

  it("renders a candidate with no vacancy id as plain text (no broken link)", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: pool([candidate({ id: "app-10", applicantName: "Orphan Person", jobOpeningId: null })]),
      source: "api",
    });
    render(await TalentPoolPage({ searchParams: {} }));
    expect(screen.getByText("Orphan Person")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Orphan Person/ })).not.toBeInTheDocument();
  });

  // GAP-RECRUITMENT-TALENT-POOL-04
  it("renders Source as plain text, not a coloured status pill", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: pool([candidate({ source: "public_portal" })]), source: "api" });
    const { container } = render(await TalentPoolPage({ searchParams: {} }));
    const cell = screen.getAllByText("Public careers portal").find((el) => el.closest("td"));
    expect(cell).toBeTruthy();
    expect(cell!.closest(".pill")).toBeNull();
    expect(container.querySelector(".pill")).not.toBeNull(); // the Stage column still renders pills
  });

  // GAP-RECRUITMENT-TALENT-POOL-05
  it("forwards source, skill, minExp and the page offset to the API, URL-encoded", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: pool([candidate({})], 120), source: "api" });
    render(await TalentPoolPage({ searchParams: { skill: "C++ & Go", minExp: "3", source: "public_portal", page: "2" } }));
    const path = fetchJsonMock.mock.calls[0][0] as string;
    expect(path).toContain("limit=50&offset=50");
    expect(path).toContain("skill=C%2B%2B%20%26%20Go");
    expect(path).toContain("minExp=3");
    expect(path).toContain("source=public_portal");
  });

  it("offers a Source filter and Next/Previous paging that keeps the active filters", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: pool([candidate({})], 120), source: "api" });
    render(await TalentPoolPage({ searchParams: { skill: "excel", source: "internal", page: "2" } }));
    expect(screen.getByLabelText("Source")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/hr/recruitment/talent-pool?skill=excel&source=internal&page=3");
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/hr/recruitment/talent-pool?skill=excel&source=internal");
  });

  // GAP-RECRUITMENT-TALENT-POOL-07
  it("uses the shared btn-tall class instead of inline minHeight on Search and Clear", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: pool([candidate({})]), source: "api" });
    render(await TalentPoolPage({ searchParams: {} }));
    const search = screen.getByRole("button", { name: "Search" });
    const clear = screen.getByRole("link", { name: "Clear" });
    expect(search.className).toContain("btn-tall");
    expect(clear.className).toContain("btn-tall");
    expect(search.getAttribute("style") ?? "").not.toContain("min-height");
    expect(clear.getAttribute("style") ?? "").not.toContain("min-height");
  });
});
