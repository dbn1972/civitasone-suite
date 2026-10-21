import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const rolesRef = vi.hoisted(() => ({ roles: ["employee"] as string[] }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesRef.roles }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
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

function route(opts: { held?: unknown[]; heldError?: boolean; competencies?: unknown[]; frameworks?: unknown[] }) {
  fetchJsonMock.mockImplementation(async (url: string, fallback: unknown, o?: { mapResponse?: (p: unknown) => unknown }) => {
    if (url.includes("/competency/frameworks")) return { data: o?.mapResponse?.({ data: opts.frameworks ?? FRAMEWORKS }), source: "api" };
    if (url.includes("/competency/competencies")) return { data: o?.mapResponse?.({ data: opts.competencies ?? COMPETENCIES }), source: "api" };
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

const statValue = (label: string) => screen.getByText(label, { selector: ".lab" }).closest(".stat")?.querySelector(".val")?.textContent;

describe("CompetencyPage category presentation (GAP-HR-COMPETENCY-04)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getMyProfileMock.mockReset();
    getMyProfileMock.mockResolvedValue({ data: { id: "emp-1" }, source: "api" });
    rolesRef.roles = ["employee"];
  });

  const MIXED = [
    { id: "c1", name: "Leadership", category: "behavioural", maxLevel: 5, certifiedLevel: 3 },
    { id: "c2", name: "Data Analysis", category: "technical", maxLevel: 4, certifiedLevel: 3 },
    { id: "c3", name: "Public Procurement", category: "general", maxLevel: 1, certifiedLevel: 1 },
    { id: "c4", name: "Budgeting", category: "functional", maxLevel: 3, certifiedLevel: 2 },
  ];

  it("prints translated category labels and 'N levels' rather than raw enum / bare number", async () => {
    route({ competencies: MIXED });
    await renderPage();
    const row = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
    expect(row("Data Analysis")).toHaveTextContent("Technical");
    expect(row("Data Analysis")).toHaveTextContent("4 levels");
    expect(row("Leadership")).toHaveTextContent("Behavioural");
    expect(row("Leadership")).toHaveTextContent("5 levels");
    expect(row("Public Procurement")).toHaveTextContent("General");
    expect(row("Public Procurement")).toHaveTextContent("1 level");
    expect(row("Public Procurement")).not.toHaveTextContent("1 levels");
    // an unknown category is shown (title-cased), not dropped
    expect(row("Budgeting")).toHaveTextContent("Functional");
  });

  it("counts every competency in exactly one tile: unknown categories land in Other", async () => {
    route({ competencies: MIXED });
    await renderPage();
    expect(statValue("Technical")).toBe("1");
    expect(statValue("Behavioural")).toBe("1");
    expect(statValue("Other")).toBe("2");
  });

  it("Other is 0 (not hidden) when every competency is technical or behavioural", async () => {
    route({});
    await renderPage();
    expect(statValue("Technical")).toBe("1");
    expect(statValue("Behavioural")).toBe("2");
    expect(statValue("Other")).toBe("0");
  });

  it("treats the US spelling and mixed case as behavioural / technical", async () => {
    route({
      competencies: [
        { id: "c1", name: "Teamwork", category: "Behavioral", maxLevel: 5, certifiedLevel: 3 },
        { id: "c2", name: "Coding", category: "TECHNICAL", maxLevel: 5, certifiedLevel: 3 },
      ],
    });
    await renderPage();
    expect(statValue("Technical")).toBe("1");
    expect(statValue("Behavioural")).toBe("1");
    expect(statValue("Other")).toBe("0");
  });
});

describe("CompetencyPage empty states and HR-only actions (GAP-HR-COMPETENCY-02)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getMyProfileMock.mockReset();
    getMyProfileMock.mockResolvedValue({ data: { id: "emp-1" }, source: "api" });
  });

  it("an employee sees no 'Add' wording or button; the empty states say to contact HR", async () => {
    rolesRef.roles = ["employee"];
    route({ competencies: [], frameworks: [] });
    await renderPage();
    expect(screen.queryByRole("button", { name: /add framework/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/add a framework/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/add competencies/i)).not.toBeInTheDocument();
    expect(screen.getByText("No frameworks defined yet. Contact HR.")).toBeInTheDocument();
    expect(screen.getByText("No competencies defined yet. Contact HR.")).toBeInTheDocument();
  });

  it("HR sees the Add framework button and the actionable empty states", async () => {
    rolesRef.roles = ["hr_admin"];
    route({ competencies: [], frameworks: [] });
    await renderPage();
    expect(screen.getByRole("button", { name: /add framework/i })).toBeInTheDocument();
    expect(screen.getByText("Add a framework to begin mapping role requirements.")).toBeInTheDocument();
    expect(screen.getByText("Add competencies within a framework to define proficiency levels.")).toBeInTheDocument();
  });

  it("a manager (not an HR role) gets the read-only wording too", async () => {
    rolesRef.roles = ["manager"];
    route({ competencies: [], frameworks: [] });
    await renderPage();
    expect(screen.queryByRole("button", { name: /add framework/i })).not.toBeInTheDocument();
    expect(screen.getByText("No competencies defined yet. Contact HR.")).toBeInTheDocument();
  });
});
