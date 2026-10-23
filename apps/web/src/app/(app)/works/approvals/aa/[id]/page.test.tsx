import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "@/app/_components/ds/Toast";
import type { ReactElement } from "react";
const renderUI = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const rolesMock = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth/roleGuard")>();
  return { ...orig, getSessionRoles: () => rolesMock() };
});

class NotFoundError extends Error {}
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  notFound: () => {
    throw new NotFoundError("NEXT_NOT_FOUND");
  },
}));

import AaDetailPage from "./page";

const RECORD = {
  id: "aa-1",
  workId: "123e4567-e89b-12d3-a456-426614174000",
  aaNumber: "AA/2026-27/001",
  aaDate: "2026-07-12",
  approvingAuthorityId: "223e4567-e89b-12d3-a456-426614174999",
  approvedAmountMinor: "50000000",
  approvalType: "original",
  status: "draft",
  remarks: null,
  createdAt: "2026-07-12",
};

describe("AaDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue(["works_admin"]);
  });

  it("fetches by id and renders the record (reachable beyond the first list page)", async () => {
    fetchJsonMock.mockResolvedValue({ data: RECORD, source: "api" });
    const ui = await AaDetailPage({ params: Promise.resolve({ id: "aa-1" }) });
    renderUI(ui);
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/v1/works/approvals/aa/aa-1",
      null,
      expect.objectContaining({ telemetryKey: "works.approvals.aa.detail" }),
    );
    expect(screen.getAllByText("AA/2026-27/001").length).toBeGreaterThan(0);
    // Work renders as a link with the full id in a tooltip, not bare text.
    const workLink = screen.getByRole("link", { name: "ID 123e4567…" });
    expect(workLink).toHaveAttribute("title", RECORD.workId);
    expect(screen.getByText(/^Unknown officer \(/)).toHaveAttribute("title", RECORD.approvingAuthorityId);
  });

  it("resolves the work number (linked to the proposal) and the officer NAME web-side (GAP-WORKS-APPROVALS-DETAIL-03)", async () => {
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url.includes("/works/proposals/")) return { data: { workNumber: "WK-2026-0042", description: "Canal" }, source: "api" };
      if (url.includes("/identity/users/directory")) return { data: [[RECORD.approvingAuthorityId, "Superintending Engineer"]], source: "api" };
      return { data: RECORD, source: "api" };
    });
    const ui = await AaDetailPage({ params: Promise.resolve({ id: "x-1" }) });
    renderUI(ui);
    const workLink = screen.getByRole("link", { name: "WK-2026-0042" });
    expect(workLink).toHaveAttribute("href", `/works/proposals/${RECORD.workId}`);
    expect(workLink).toHaveAttribute("title", RECORD.workId);
    expect(screen.getByText("Superintending Engineer")).toBeInTheDocument();
    expect(screen.queryByText(/Authority \(ID\)/)).not.toBeInTheDocument();
  });

  it("calls notFound() only for a definitive 404", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(AaDetailPage({ params: Promise.resolve({ id: "missing" }) })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("shows a retryable load-error state (NOT a 404) when the fetch fails for a non-404 reason", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    const ui = await AaDetailPage({ params: Promise.resolve({ id: "aa-1" }) });
    renderUI(ui);
    expect(screen.getByText(/could not load this record/i)).toBeInTheDocument();
  });

  it("disables Finalize for a user without an approver role", async () => {
    rolesMock.mockReturnValue(["works_viewer"]);
    fetchJsonMock.mockResolvedValue({ data: RECORD, source: "api" });
    const ui = await AaDetailPage({ params: Promise.resolve({ id: "aa-1" }) });
    renderUI(ui);
    const btn = screen.getByRole("button", { name: "Finalize AA" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
