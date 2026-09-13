import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import OnboardingDetailPage from "./page";

const SUMMARY_ROW = {
  id: "emp-1",
  employee: "Priya Nair",
  department: "Finance",
  joiningDate: "2026-08-01",
  stepsCompleted: "1/3",
  totalSteps: "3",
  progress: "33%",
  status: "in_progress",
};

const SUMMARY_ROW_2 = {
  id: "emp-2",
  employee: "Rahul Verma",
  department: "IT",
  joiningDate: "2026-07-01",
  stepsCompleted: "2/3",
  totalSteps: "3",
  progress: "67%",
  status: "in_progress",
};

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

// Employee 2: a completely different, independent real state -- one
// verified, one rejected, the rest pending. Deliberately NOT the same shape
// as employee 1's state above, so a bug that shows the same data for every
// employee cannot pass both this and the DOCS_EMP1 assertions at once.
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
  return { data: [SUMMARY_ROW], source: "api" };
}

describe("OnboardingDetailPage", () => {
  it("renders the employee's real onboarding tasks, not invented placeholder progress", async () => {
    fetchJsonMock.mockImplementation((path: string) => Promise.resolve(mockFor(path)));
    render(await OnboardingDetailPage({ params: Promise.resolve({ id: "emp-1" }) }));

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

  it("does not fabricate a specific reporting manager or office location the API never sent", async () => {
    fetchJsonMock.mockImplementation((path: string) => Promise.resolve(mockFor(path)));
    render(await OnboardingDetailPage({ params: Promise.resolve({ id: "emp-1" }) }));

    expect(screen.queryByText("Department Head")).not.toBeInTheDocument();
    expect(screen.queryByText(/Head Office, New Delhi/)).not.toBeInTheDocument();
  });

  it("shows a genuine empty state instead of a fabricated 6-step checklist when no tasks exist yet", async () => {
    fetchJsonMock.mockImplementation((path: string) =>
      Promise.resolve(path.includes("/onboarding-tasks") ? { data: [], source: "api" } : mockFor(path)),
    );
    render(await OnboardingDetailPage({ params: Promise.resolve({ id: "emp-1" }) }));

    expect(screen.getByText(/no onboarding tasks set up yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Documents Submitted")).not.toBeInTheDocument();
  });

  it("flags the data source as error if either the summary or the tasks fetch fails", async () => {
    fetchJsonMock.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes("/onboarding-tasks")
          ? { data: [], source: "error" }
          : mockFor(path),
      ),
    );
    render(await OnboardingDetailPage({ params: Promise.resolve({ id: "emp-1" }) }));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("flags the data source as error if the documents fetch fails, even when summary and tasks succeed", async () => {
    fetchJsonMock.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes("/onboarding-documents")
          ? { data: [], source: "error" }
          : mockFor(path),
      ),
    );
    render(await OnboardingDetailPage({ params: Promise.resolve({ id: "emp-1" }) }));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  // COMP-015 regression: the document checklist used to be DEFAULT_DOCUMENTS,
  // a hardcoded array with every status "pending", rendered identically for
  // every employee regardless of what HR had actually collected or verified.
  // The two tests below prove two different employees now render two
  // different, real, independently-tracked document states.
  it("renders employee 1's own real document checklist (one uploaded, five genuinely still pending)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/onboarding-documents")) return Promise.resolve({ data: DOCS_EMP1, source: "api" });
      if (path.includes("/onboarding-tasks")) return Promise.resolve({ data: REAL_TASKS, source: "api" });
      return Promise.resolve({ data: [SUMMARY_ROW, SUMMARY_ROW_2], source: "api" });
    });
    render(await OnboardingDetailPage({ params: Promise.resolve({ id: "emp-1" }) }));

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
      return Promise.resolve({ data: [SUMMARY_ROW, SUMMARY_ROW_2], source: "api" });
    });
    render(await OnboardingDetailPage({ params: Promise.resolve({ id: "emp-2" }) }));

    expect(screen.getAllByText("VERIFIED")).toHaveLength(1);
    expect(screen.getAllByText("REJECTED")).toHaveLength(1);
    expect(screen.getAllByText("PENDING")).toHaveLength(4);
    // Employee 1's uploaded government-ID state must not leak into employee 2.
    expect(screen.queryByText("UPLOADED")).not.toBeInTheDocument();
  });
});
