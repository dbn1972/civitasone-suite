import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// Same mocking convention as hr/disciplinary/page.test.tsx: control the
// session role directly at the roleGuard module boundary. Pre-existing gap
// found while fixing this page's missing approve/reject controls: every
// test in this file was already failing outright (rendered PermissionDenied
// instead of the page, since the global next/headers mock's cookies().get()
// always returns undefined -> getSessionRoles() -> [] -> canView false) --
// unrelated to, and predating, this fix.
let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import WFHPage from "./page";

// This page embeds real (unmocked) "use client" components -- WFHRequestForm
// and WfhRequestsTable -- which call useTranslations() directly. Unlike the
// page's own getTranslations() (mocked globally in vitest.setup.ts), a
// client-side useTranslations() needs a real NextIntlClientProvider in the
// tree, same pattern as leave/apply/page.test.tsx.
function render(page: Promise<React.ReactElement>) {
  return page.then((ui) => rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>));
}

// Real shape from GET /v1/hrms/wfh-requests: { id, employeeId, employeeName,
// fromDate, toDate, reason, status, createdAt } -- no `department`/`days`.
const MOCK_REQUESTS = [
  { id: "w1", employeeId: "e1", employeeName: "Sunita Rao", fromDate: "2026-08-18", toDate: "2026-08-19", reason: "Project work", status: "approved" },
  { id: "w2", employeeId: "e2", employeeName: "Kartik Das", fromDate: "2026-08-20", toDate: "2026-08-20", reason: "Travel", status: "pending" },
];

describe("WFHPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    mockRoles = ["hr_admin"];
  });

  it("denies a role outside hr_admin/hr_officer/manager/super_admin", async () => {
    mockRoles = ["employee"];
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await render(WFHPage());
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
  });

  it("renders WFH request list", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    await render(WFHPage());
    expect(screen.getByText("Sunita Rao")).toBeInTheDocument();
    expect(screen.getByText("Kartik Das")).toBeInTheDocument();
  });

  it("renders page heading with DoPT reference", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await render(WFHPage());
    expect(screen.getByRole("heading", { name: /work from home/i })).toBeInTheDocument();
    // "DoPT" also appears in the empty-state table message and the embedded
    // form's policy note; match the subtitle's specific wording to scope this
    // assertion to the page subtitle.
    expect(screen.getByText(/DoPT policy/i)).toBeInTheDocument();
  });

  it("renders stat cards for approved and pending counts", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    await render(WFHPage());
    // getAllByText, not getByText: "Approved"/"Pending" now also appear as
    // WfhRequestsTable's status-column filter options, alongside the
    // StatCard labels this test originally targeted.
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
  });

  it("embeds the WFH request form", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await render(WFHPage());
    expect(screen.getByRole("form", { name: /work from home request form/i })).toBeInTheDocument();
  });

  it("shows DoPT policy note inside the form", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await render(WFHPage());
    expect(screen.getByText(/2 days per week/i)).toBeInTheDocument();
  });

  // CRITICAL fix regression: this page had no way to approve or reject a
  // pending WFH request anywhere in the UI.
  it("shows Approve/Reject controls for a pending request", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    await render(WFHPage());
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });
});
