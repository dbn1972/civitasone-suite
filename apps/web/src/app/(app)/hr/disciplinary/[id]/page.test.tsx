import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let mockRoles: string[] = ["hr_admin"];
let mockUserId: string | null = "u1";
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
  getSessionUserId: () => mockUserId,
}));

// CaseActions (GAP-HR-DISCIPLINARY-DETAIL-06) is a client component: give it
// the English catalogue and a router, as the real provider tree would.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  const en = (await import("@/messages/en.json")).default as unknown as Record<string, Record<string, unknown>>;
  return {
    ...actual,
    useTranslations: (ns: string) => (key: string) =>
      key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], en[ns]) as string ?? key,
  };
});

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import DisciplinaryCaseDetailPage from "./page";

const BASE_CASE = {
  id: "case-1",
  tenantId: "t1",
  employeeId: "emp-1",
  caseNo: "DC/2026/0007",
  proceedingType: "major",
  status: "inquiry_appointed",
  allegation: "Alleged misconduct under the CCS (CCA) Rules.",
  chargeMemoRef: "CM/2026/003",
  chargeMemoDate: "2026-01-10",
  inquiryOfficerId: "io-1",
  inquiryOfficerName: "R. Menon",
  inquiryAppointedDate: "2026-01-20",
  finding: null,
  findingNotes: null,
  findingDate: null,
  penaltyClass: null,
  penaltyType: null,
  penaltyDetail: null,
  penaltyDate: null,
  appealFiledDate: null,
  appealAuthority: null,
  appealOutcome: null,
  appealDecidedDate: null,
  closedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-20T00:00:00.000Z",
  createdBy: "u1",
  updatedBy: "u1",
  version: 1,
};

// Routes by URL: disciplinary-cases/:id (case), employees/:id (employee),
// .../events (timeline) -- all three go through the same fetchJson, mocked
// once here and branched by the requested path.
function mockLoaders(opts?: {
  caseResult?: unknown;
  employeeResult?: unknown;
  eventsResult?: unknown;
}) {
  fetchJsonMock.mockImplementation((url: string) => {
    if (url.includes("/disciplinary-cases/") && url.includes("/events")) {
      return Promise.resolve(opts?.eventsResult ?? { data: [], source: "api" });
    }
    if (url.includes("/disciplinary-cases/")) {
      return Promise.resolve(opts?.caseResult ?? { data: BASE_CASE, source: "api" });
    }
    if (url.includes("/employees/")) {
      return Promise.resolve(
        opts?.employeeResult ?? { data: { id: "emp-1", employeeId: "E-100", name: "A. Kumar" }, source: "api" },
      );
    }
    return Promise.resolve({ data: null, source: "error", status: 404 });
  });
}

describe("DisciplinaryCaseDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    mockRoles = ["hr_admin"];
    mockUserId = "u1";
  });

  it("shows an honest permission-denied state for a role the backend would reject", async () => {
    mockRoles = ["employee"];
    const ui = await DisciplinaryCaseDetailPage({ params: { id: "case-1" } });
    render(ui);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("shows 'Case not found' for a genuine 404", async () => {
    mockLoaders({ caseResult: { data: null, source: "error", status: 404 } });
    const ui = await DisciplinaryCaseDetailPage({ params: { id: "does-not-exist" } });
    render(ui);
    expect(screen.getByText("Case not found")).toBeInTheDocument();
  });

  it("shows a retryable error state (GAP-HR-DISCIPLINARY-DETAIL-02), NOT 'Case not found', on a 5xx", async () => {
    mockLoaders({ caseResult: { data: null, source: "error", status: 500 } });
    const ui = await DisciplinaryCaseDetailPage({ params: { id: "case-1" } });
    render(ui);
    expect(screen.queryByText("Case not found")).not.toBeInTheDocument();
  });

  it("also treats a network error (no HTTP status at all) as a retryable error, never 'Case not found'", async () => {
    mockLoaders({ caseResult: { data: null, source: "error" } });
    const ui = await DisciplinaryCaseDetailPage({ params: { id: "case-1" } });
    render(ui);
    expect(screen.queryByText("Case not found")).not.toBeInTheDocument();
  });

  it("shows the employee's real name (GAP-HR-DISCIPLINARY-DETAIL-03), not just the case fields", async () => {
    mockLoaders();
    const ui = await DisciplinaryCaseDetailPage({ params: { id: "case-1" } });
    render(ui);
    expect(screen.getByText("A. Kumar (E-100)")).toBeInTheDocument();
    expect(screen.getByText("R. Menon")).toBeInTheDocument();
  });

  it("translates the proceeding type instead of printing the raw enum (GAP-HR-DISCIPLINARY-DETAIL-04)", async () => {
    mockLoaders();
    const ui = await DisciplinaryCaseDetailPage({ params: { id: "case-1" } });
    render(ui);
    expect(screen.queryByText("major", { exact: true })).not.toBeInTheDocument();
    expect(screen.getAllByText("Major (Vigilance)").length).toBeGreaterThan(0);
  });

  it("falls back to a translated placeholder, never the raw UUID, when case_no is missing", async () => {
    mockLoaders({ caseResult: { data: { ...BASE_CASE, caseNo: "" }, source: "api" } });
    const ui = await DisciplinaryCaseDetailPage({ params: { id: "case-1" } });
    render(ui);
    expect(screen.queryByText("case-1")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Case \(number not yet assigned\)/).length).toBeGreaterThan(0);
  });

  it("renders the status-history timeline from the events route (GAP-HR-DISCIPLINARY-DETAIL-03)", async () => {
    mockLoaders({
      eventsResult: {
        data: [
          {
            id: "ev1", tenantId: "t1", caseId: "case-1", fromStatus: "opened",
            toStatus: "charge_memo_issued", action: "issue_charge_memo",
            notes: null, occurredAt: "2026-01-05T00:00:00.000Z", actorId: "u1",
          },
        ],
        source: "api",
      },
    });
    const ui = await DisciplinaryCaseDetailPage({ params: { id: "case-1" } });
    render(ui);
    expect(screen.getByText("Status History")).toBeInTheDocument();
    expect(screen.getByText("Issue Charge Memo")).toBeInTheDocument();
  });

  it("shows the confidentiality notice (GAP-HR-DISCIPLINARY-DETAIL-01)", async () => {
    mockLoaders();
    const ui = await DisciplinaryCaseDetailPage({ params: { id: "case-1" } });
    render(ui);
    expect(screen.getByText("Confidential — Disciplinary Case")).toBeInTheDocument();
  });

  // GAP-HR-DISCIPLINARY-DETAIL-06
  it("offers the next state-machine action to the case creator (inquiry_appointed -> record finding)", async () => {
    mockLoaders();
    const ui = await DisciplinaryCaseDetailPage({ params: { id: "case-1" } });
    render(ui);
    expect(screen.getByRole("button", { name: "Record finding" })).toBeInTheDocument();
  });

  it("offers the actions to the assigned inquiry officer too", async () => {
    mockUserId = "io-1";
    mockLoaders({ caseResult: { data: { ...BASE_CASE, createdBy: "someone-else" }, source: "api" } });
    const ui = await DisciplinaryCaseDetailPage({ params: { id: "case-1" } });
    render(ui);
    expect(screen.getByRole("button", { name: "Record finding" })).toBeInTheDocument();
  });

  it("shows no action buttons to a user who is neither creator nor inquiry officer", async () => {
    mockUserId = "u-other";
    mockLoaders();
    const ui = await DisciplinaryCaseDetailPage({ params: { id: "case-1" } });
    render(ui);
    expect(screen.queryByRole("button", { name: "Record finding" })).not.toBeInTheDocument();
    expect(screen.getByText(/only the case creator or the assigned inquiry officer/i)).toBeInTheDocument();
  });
});
