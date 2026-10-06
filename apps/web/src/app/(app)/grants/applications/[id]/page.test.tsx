import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const getApplicationByIdMock = vi.fn();
const getSchemeByIdMock = vi.fn();
vi.mock("../../_data", () => ({
  getApplicationById: (id: string) => getApplicationByIdMock(id),
  getSchemeById: (id: string) => getSchemeByIdMock(id),
}));

const getGranteeByIdMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getGranteeById: (id: string) => getGranteeByIdMock(id),
}));

const rolesMock = vi.fn<() => string[]>(() => ["grant_admin"]);
const userIdMock = vi.fn<() => string | null>(() => "officer-1");
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  getSessionUserId: () => userIdMock(),
  hasAnyRole: (sessionRoles: string[], allowed: string[]) => allowed.some((r) => sessionRoles.includes(r)),
}));

import ApplicationDetailPage from "./page";

const APP = {
  id: "app-1",
  grantNo: "GNT-2026-27-00001",
  schemeId: "scheme-1",
  beneficiaryId: "ben-1",
  status: "submitted",
  purpose: "Community water supply project for the eastern ward",
  amountRequestedMinor: 4500000,
  amountApprovedMinor: null,
  submittedBy: "clerk-1",
  approvedBy: null,
  submittedAt: "2026-08-01",
  approvedAt: null,
  createdAt: "2026-08-01",
  reviewerRef: "identity_user:rev-9",
  technicalScore: 82,
  financialScore: 70,
  totalScore: 76,
  recommendation: "Recommended with conditions",
};

describe("ApplicationDetailPage", () => {
  beforeEach(() => {
    getApplicationByIdMock.mockReset();
    getSchemeByIdMock.mockReset();
    getGranteeByIdMock.mockReset();
    rolesMock.mockReturnValue(["grant_admin"]);
    userIdMock.mockReturnValue("officer-1");
    getApplicationByIdMock.mockResolvedValue({ data: APP, source: "api" });
    getSchemeByIdMock.mockResolvedValue({ data: { id: "scheme-1", code: "SCH-1", name: "Rural Water Scheme", minAmountMinor: 1000000, maxAmountMinor: 5000000 }, source: "api" });
    getGranteeByIdMock.mockResolvedValue({ data: { id: "ben-1", name: "Gram Panchayat Alpha" }, source: "api" });
  });

  it("renders exactly one breadcrumb back-link to /grants/applications", async () => {
    render(await ApplicationDetailPage({ params: { id: "app-1" } }));
    const backLinks = screen.getAllByRole("link", { name: "Applications" });
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute("href", "/grants/applications");
  });

  // GAP-GRANTS-APPLICATIONS-DETAIL-06: scheme + grantee NAMES, not uuids.
  it("shows the scheme name and grantee name instead of uuids", async () => {
    render(await ApplicationDetailPage({ params: { id: "app-1" } }));
    expect(screen.getByText(/Rural Water Scheme/)).toBeInTheDocument();
    expect(screen.getByText("Gram Panchayat Alpha")).toBeInTheDocument();
    // the raw application uuid is NOT shown as a monospace field anymore
    expect(screen.queryByText("app-1")).not.toBeInTheDocument();
  });

  // GAP-GRANTS-APPLICATIONS-DETAIL-05: evaluation card shows the scores.
  it("shows the evaluation scores and recommendation", async () => {
    render(await ApplicationDetailPage({ params: { id: "app-1" } }));
    expect(screen.getByText("Evaluation")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("Recommended with conditions")).toBeInTheDocument();
  });

  // GAP-GRANTS-APPLICATIONS-DETAIL-02: the submitter sees the maker-checker note.
  it("blocks maker actions for the submitter (maker-checker)", async () => {
    userIdMock.mockReturnValue("clerk-1"); // same as submittedBy
    render(await ApplicationDetailPage({ params: { id: "app-1" } }));
    expect(screen.getByText(/separation of duties/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve Application" })).not.toBeInTheDocument();
  });

  // GAP-GRANTS-APPLICATIONS-DETAIL-03: a failed fetch shows a retry/permission
  // state, NOT notFound().
  it("renders a load-error state on a non-404 failure instead of notFound", async () => {
    getApplicationByIdMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    const page = await ApplicationDetailPage({ params: { id: "app-1" } });
    render(page);
    expect(screen.getAllByText(/try again|couldn't load|couldn’t load|access restricted|retry/i).length).toBeGreaterThan(0);
  });

  it("calls notFound for a genuine 404", async () => {
    getApplicationByIdMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(ApplicationDetailPage({ params: { id: "app-1" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
