import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
const getSessionRolesMock = vi.fn(() => ["hr_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND_MARKER");
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import OnboardingDetailPage from "./page";

function employeeDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: "emp-1",
    employeeId: "E001",
    name: "Priya Nair",
    department: "Finance",
    designation: "Officer",
    joiningDate: "2026-08-01",
    status: "active",
    bankAccountNo: null,
    bankIfsc: null,
    pan: null,
    ...overrides,
  };
}

function employeeFor(id: string) {
  if (id === "emp-2") return employeeDetail({ id: "emp-2", employeeId: "E002", name: "Rahul Verma", department: "IT", joiningDate: "2026-07-01" });
  return employeeDetail();
}

const REAL_TASKS = [
  { id: "task-1", title: "Submit joining report", dueByDay: 1, status: "completed" },
  { id: "task-2", title: "Collect department ID badge", dueByDay: 3, status: "pending" },
  { id: "task-3", title: "Complete cyber-security briefing", dueByDay: 7, status: "pending" },
];

// Employee 1: HR has actioned exactly one of the six required documents.
const DOCS_EMP1 = [
  { docType: "appointment_letter", required: true, status: "pending", receivedAt: null, verifiedBy: null, verifiedAt: null },
  { docType: "government_id", required: true, status: "uploaded", receivedAt: "2026-08-02T00:00:00Z", verifiedBy: null, verifiedAt: null },
  { docType: "address_proof", required: true, status: "pending", receivedAt: null, verifiedBy: null, verifiedAt: null },
  { docType: "education_certificate", required: true, status: "pending", receivedAt: null, verifiedBy: null, verifiedAt: null },
  { docType: "pan_card", required: true, status: "pending", receivedAt: null, verifiedBy: null, verifiedAt: null },
  { docType: "bank_details", required: true, status: "pending", receivedAt: null, verifiedBy: null, verifiedAt: null },
];

// Employee 2: a completely different, independent real state.
const DOCS_EMP2 = [
  { docType: "appointment_letter", required: true, status: "verified", receivedAt: "2026-07-02T00:00:00Z", verifiedBy: "hr-1", verifiedAt: "2026-07-03T00:00:00Z" },
  { docType: "government_id", required: true, status: "pending", receivedAt: null, verifiedBy: null, verifiedAt: null },
  { docType: "address_proof", required: true, status: "pending", receivedAt: null, verifiedBy: null, verifiedAt: null },
  { docType: "education_certificate", required: true, status: "pending", receivedAt: null, verifiedBy: null, verifiedAt: null },
  { docType: "pan_card", required: true, status: "rejected", receivedAt: "2026-07-02T00:00:00Z", verifiedBy: "hr-2", verifiedAt: "2026-07-04T00:00:00Z" },
  { docType: "bank_details", required: true, status: "pending", receivedAt: null, verifiedBy: null, verifiedAt: null },
];

function mockFor(path: string) {
  if (path.includes("/onboarding-tasks")) return { data: REAL_TASKS, source: "api" };
  if (path.includes("/onboarding-documents")) return { data: [], source: "api" };
  const m = /\/employees\/([^/?]+)/.exec(path);
  return { data: employeeFor(m?.[1] ?? "emp-1"), source: "api" };
}

describe("OnboardingDetailPage", () => {
  it("renders the employee's real onboarding tasks, not invented placeholder progress", async () => {
    fetchJsonMock.mockImplementation((path: string) => Promise.resolve(mockFor(path)));
    render(await OnboardingDetailPage({ params: { id: "emp-1" } }));

    // Real task titles appear once in the checklist panel and once in the task
    // calendar panel — both are legitimate, so assert presence, not uniqueness.
    expect(screen.getAllByText("Submit joining report").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Collect department ID badge").length).toBeGreaterThan(0);

    // These exact strings were the hardcoded fallback shown for every joinee,
    // regardless of their real state — must never appear again.
    expect(screen.queryByText("Documents Submitted")).not.toBeInTheDocument();
    expect(screen.queryByText("ID Card Issued")).not.toBeInTheDocument();
    expect(screen.queryByText("Probation Review Scheduled")).not.toBeInTheDocument();
  });

  // GAP-HR-ONBOARDING-DETAIL-04
  it("shows honest placeholders, not fabricated specifics, when the API has no manager/location on file", async () => {
    fetchJsonMock.mockImplementation((path: string) => Promise.resolve(mockFor(path)));
    render(await OnboardingDetailPage({ params: { id: "emp-1" } }));

    expect(screen.queryByText("Department Head")).not.toBeInTheDocument();
    expect(screen.queryByText(/Head Office, New Delhi/)).not.toBeInTheDocument();
    expect(screen.getByText("Not yet assigned")).toBeInTheDocument();
    expect(screen.getByText("Not specified")).toBeInTheDocument();
  });

  it("GAP-HR-ONBOARDING-DETAIL-04: shows the real manager/location once the API has them, instead of always showing the placeholder", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/onboarding-tasks")) return Promise.resolve({ data: REAL_TASKS, source: "api" });
      if (path.includes("/onboarding-documents")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: employeeDetail({ reportingTo: "Anita Rao", postingLocation: "Bhubaneswar HQ" }), source: "api" });
    });
    render(await OnboardingDetailPage({ params: { id: "emp-1" } }));

    expect(screen.getByText("Anita Rao")).toBeInTheDocument();
    expect(screen.getByText("Bhubaneswar HQ")).toBeInTheDocument();
    expect(screen.queryByText("Not yet assigned")).not.toBeInTheDocument();
    expect(screen.queryByText("Not specified")).not.toBeInTheDocument();
  });

  it("GAP-HR-ONBOARDING-DETAIL-04: formats the joining date instead of printing the raw ISO string", async () => {
    fetchJsonMock.mockImplementation((path: string) => Promise.resolve(mockFor(path)));
    render(await OnboardingDetailPage({ params: { id: "emp-1" } }));
    expect(screen.queryByText(/Joining 2026-08-01/)).not.toBeInTheDocument();
  });

  it("shows a genuine empty state instead of a fabricated 6-step checklist when no tasks exist yet, with an Add task action", async () => {
    fetchJsonMock.mockImplementation((path: string) =>
      Promise.resolve(path.includes("/onboarding-tasks") ? { data: [], source: "api" } : mockFor(path)),
    );
    render(await OnboardingDetailPage({ params: { id: "emp-1" } }));

    expect(screen.getByText(/no onboarding tasks set up yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Documents Submitted")).not.toBeInTheDocument();
    // GAP-HR-ONBOARDING-02: previously a dead end -- a joinee with zero
    // tasks is now openable (DETAIL-05) AND has a real way to get tasks.
    expect(screen.getByLabelText("Task title")).toBeInTheDocument();
  });

  // GAP-HR-ONBOARDING-DETAIL-05
  it("GAP-HR-ONBOARDING-DETAIL-05: opens for a joinee with zero tasks instead of 404ing (previously indistinguishable from 'doesn't exist')", async () => {
    fetchJsonMock.mockImplementation((path: string) =>
      Promise.resolve(path.includes("/onboarding-tasks") ? { data: [], source: "api" } : mockFor(path)),
    );
    const ui = await OnboardingDetailPage({ params: { id: "emp-1" } });
    render(ui); // does not throw NEXT_NOT_FOUND_MARKER
    expect(screen.getByText(/Onboarding — Priya Nair/)).toBeInTheDocument();
  });

  it("GAP-HR-ONBOARDING-DETAIL-05: calls notFound() only when the employee itself is genuinely missing (a real 404), not on a fetch failure", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/employees/")) return Promise.resolve({ data: null, source: "error", status: 404 });
      return Promise.resolve(mockFor(path));
    });
    await expect(OnboardingDetailPage({ params: { id: "does-not-exist" } })).rejects.toThrow("NEXT_NOT_FOUND_MARKER");
  });

  it("GAP-HR-ONBOARDING-DETAIL-05: shows a refresh-suggesting error state (not notFound) when the employee fetch fails for another reason", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/employees/")) return Promise.resolve({ data: null, source: "error", status: 500 });
      return Promise.resolve(mockFor(path));
    });
    const ui = await OnboardingDetailPage({ params: { id: "emp-1" } });
    render(ui);
    // This early-return branch (the employee fetch itself failed) renders
    // RefreshErrorState directly rather than the normal page body with a
    // DataSourceBadge -- assert on its own content, not on
    // DataSourceBadge's role="status", which the other error tests below
    // (tasks/documents failing while the employee fetch succeeds) use.
    expect(screen.getByText(/couldn't load onboarding details/i)).toBeInTheDocument();
  });

  it("flags the data source as error if the tasks fetch fails", async () => {
    fetchJsonMock.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes("/onboarding-tasks")
          ? { data: [], source: "error" }
          : mockFor(path),
      ),
    );
    render(await OnboardingDetailPage({ params: { id: "emp-1" } }));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("flags the data source as error if the documents fetch fails, even when the employee and tasks fetches succeed", async () => {
    fetchJsonMock.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes("/onboarding-documents")
          ? { data: [], source: "error" }
          : mockFor(path),
      ),
    );
    render(await OnboardingDetailPage({ params: { id: "emp-1" } }));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  // COMP-015 regression: the document checklist used to be DEFAULT_DOCUMENTS,
  // a hardcoded array with every status "pending", rendered identically for
  // every employee. The two tests below prove two different employees now
  // render two different, real, independently-tracked document states.
  it("renders employee 1's own real document checklist (one uploaded, five genuinely still pending)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/onboarding-documents")) return Promise.resolve({ data: DOCS_EMP1, source: "api" });
      if (path.includes("/onboarding-tasks")) return Promise.resolve({ data: REAL_TASKS, source: "api" });
      return Promise.resolve(mockFor(path));
    });
    render(await OnboardingDetailPage({ params: { id: "emp-1" } }));

    expect(screen.getByText("Government ID Proof")).toBeInTheDocument();
    expect(screen.getAllByText("UPLOADED")).toHaveLength(1);
    expect(screen.getAllByText("PENDING")).toHaveLength(5);
    expect(screen.queryByText("VERIFIED")).not.toBeInTheDocument();
    expect(screen.queryByText("REJECTED")).not.toBeInTheDocument();
  });

  it("renders employee 2's own real document checklist, independent of employee 1's state (one verified, one rejected, four pending)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/onboarding-documents")) return Promise.resolve({ data: DOCS_EMP2, source: "api" });
      if (path.includes("/onboarding-tasks")) return Promise.resolve({ data: REAL_TASKS, source: "api" });
      return Promise.resolve(mockFor(path));
    });
    render(await OnboardingDetailPage({ params: { id: "emp-2" } }));

    expect(screen.getAllByText("VERIFIED")).toHaveLength(1);
    expect(screen.getAllByText("REJECTED")).toHaveLength(1);
    expect(screen.getAllByText("PENDING")).toHaveLength(4);
    // Employee 1's uploaded government-ID state must not leak into employee 2.
    expect(screen.queryByText("UPLOADED")).not.toBeInTheDocument();
    // Confirms this test truly used employee 2's own identity, not employee 1's.
    expect(screen.getByText(/Onboarding — Rahul Verma/)).toBeInTheDocument();
  });

  it("GAP-HR-ONBOARDING-DETAIL-01: still wires the checklist to a real 'Mark done' action", async () => {
    fetchJsonMock.mockImplementation((path: string) => Promise.resolve(mockFor(path)));
    render(await OnboardingDetailPage({ params: { id: "emp-1" } }));
    expect(
      screen.getByRole("button", { name: /mark "collect department id badge" as complete/i }),
    ).toBeInTheDocument();
    // The already-completed task must not offer a redundant "Mark done".
    expect(
      screen.queryByRole("button", { name: /mark "submit joining report" as complete/i }),
    ).not.toBeInTheDocument();
  });

  it("shows PermissionDenied instead of fetching anything for a role outside HR", async () => {
    getSessionRolesMock.mockReturnValueOnce(["employee"]);
    fetchJsonMock.mockClear();
    render(await OnboardingDetailPage({ params: { id: "emp-1" } }));
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});
