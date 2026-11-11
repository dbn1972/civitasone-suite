import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

// UAT Phase 2 C3 (J13): report detail + the actions each role/state is offered.
const getInspectionReportByIdMock = vi.fn();
vi.mock("../../_data/loaders", () => ({ getInspectionReportById: (...a: unknown[]) => getInspectionReportByIdMock(...a) }));
let roles: string[] = [];
let me: string | null = null;
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles, getSessionUserId: () => me }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import InspectionReportPage from "./page";

const MAKER = "11111111-0000-4000-8000-000000000001";
const CHECKER = "22222222-0000-4000-8000-000000000001";
const ID = "aaaaaaaa-1111-4000-8000-000000000001";
const base = {
  id: ID, inspectionId: "bbbbbbbb-1111-4000-8000-000000000001", entityId: "eeeeeeee-1111-4000-8000-000000000001",
  inspectorId: MAKER, createdBy: MAKER, updatedBy: MAKER, reportType: "standard", overallGrade: "A",
  summary: "All good", observations: [{ id: "o1", category: "Safety", severity: "major", description: "Exit blocked", location: "Block A" }],
};
const load = (over: Record<string, unknown>) => getInspectionReportByIdMock.mockResolvedValue({ data: { ...base, ...over }, source: "api" });
const page = async () => render(await InspectionReportPage({ params: Promise.resolve({ id: ID }) }));

beforeEach(() => { getInspectionReportByIdMock.mockReset(); roles = []; me = null; });

describe("InspectionReportPage", () => {
  it("shows the report, its observations, and Submit + Add observation to the inspector on a draft", async () => {
    load({ status: "draft" });
    roles = ["inspector"]; me = MAKER;
    await page();
    expect(screen.getByText("All good")).toBeInTheDocument();
    expect(screen.getByText("Exit blocked")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Major" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save observation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve report" })).toBeNull();
  });

  it("offers Approve to a different reviewing officer on a submitted report", async () => {
    load({ status: "submitted", submittedBy: MAKER });
    roles = ["reviewing_officer"]; me = CHECKER;
    await page();
    expect(screen.getByRole("button", { name: "Approve report" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit for review" })).toBeNull();
  });

  it("does not offer Approve to the officer who prepared or submitted it (maker-checker)", async () => {
    load({ status: "submitted", submittedBy: MAKER });
    roles = ["reviewing_officer"]; me = MAKER;
    await page();
    expect(screen.queryByRole("button", { name: "Approve report" })).toBeNull();
    expect(screen.getByText(/another reviewing officer must approve it/)).toBeInTheDocument();
  });

  it("offers Reject next to Approve to a different reviewing officer on a submitted report", async () => {
    load({ status: "submitted", submittedBy: MAKER });
    roles = ["reviewing_officer"]; me = CHECKER;
    await page();
    expect(screen.getByRole("button", { name: "Reject report" })).toBeInTheDocument();
  });

  it("does not offer Reject to the officer who prepared or submitted it", async () => {
    load({ status: "submitted", submittedBy: MAKER });
    roles = ["reviewing_officer"]; me = MAKER;
    await page();
    expect(screen.queryByRole("button", { name: "Reject report" })).toBeNull();
  });

  it("shows a rejected report's status, reason and date, and offers the inspector Resubmit + Add observation", async () => {
    load({ status: "rejected", rejectedAt: "2026-11-05T05:00:00.000Z", rejectedBy: CHECKER, rejectionReason: "Grade not supported by observations" });
    roles = ["inspector"]; me = MAKER;
    await page();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText("Grade not supported by observations")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/was rejected/);
    expect(screen.getByRole("button", { name: "Resubmit for review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save observation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject report" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve report" })).toBeNull();
  });

  it("offers no actions on an approved report", async () => {
    load({ status: "approved", approvedAt: "2026-11-03T05:00:00.000Z" });
    roles = ["reviewing_officer", "inspector"]; me = CHECKER;
    await page();
    expect(screen.getByText("Approved", { selector: ".pill" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve report" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save observation" })).toBeNull();
  });

  it("404 -> not found; other failures -> an error state", async () => {
    getInspectionReportByIdMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(InspectionReportPage({ params: Promise.resolve({ id: ID }) })).rejects.toThrow("NEXT_NOT_FOUND");
    getInspectionReportByIdMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    await page();
    expect(screen.queryByText("All good")).toBeNull();
  });
});
