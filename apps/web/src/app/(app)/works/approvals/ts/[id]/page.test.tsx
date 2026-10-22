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

import TsDetailPage from "./page";

const RECORD = {
  id: "ts-1",
  workId: "123e4567-e89b-12d3-a456-426614174000",
  tsNumber: "TS/2026-27/001",
  tsDate: "2026-07-12",
  tsAuthorityId: "223e4567-e89b-12d3-a456-426614174999",
  tsAmountMinor: "50000000",
  sanctionType: "original",
  status: "draft",
  remarks: null,
  createdAt: "2026-07-12",
};

describe("TsDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue(["dao"]);
  });

  it("fetches by id and renders the record", async () => {
    fetchJsonMock.mockResolvedValue({ data: RECORD, source: "api" });
    const ui = await TsDetailPage({ params: { id: "ts-1" } });
    renderUI(ui);
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/v1/works/approvals/ts/ts-1",
      null,
      expect.objectContaining({ telemetryKey: "works.approvals.ts.detail" }),
    );
    expect(screen.getAllByText("TS/2026-27/001").length).toBeGreaterThan(0);
    // No work number and no officer name could be resolved: the work is labelled as an ID (never a bare hash), the
    // authority reads "Unknown officer (<short id>)", and both keep the full id as a tooltip.
    const workLink = screen.getByRole("link", { name: "ID 123e4567…" });
    expect(workLink).toHaveAttribute("title", RECORD.workId);
    expect(workLink).toHaveAttribute("href", `/works/proposals/${RECORD.workId}`);
    const authority = screen.getByText("Unknown officer (223e4567…)");
    expect(authority).toHaveAttribute("title", RECORD.tsAuthorityId);
    expect(screen.queryByText("223e4567…")).not.toBeInTheDocument();
  });

  it("when the officer lookup fails the authority falls back to 'Unknown officer (<short id>)', not a bare hash (TS-DETAIL-03)", async () => {
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url.includes("/identity/users/directory")) return { data: [], source: "error", status: 500 };
      return { data: RECORD, source: "api" };
    });
    const ui = await TsDetailPage({ params: { id: "ts-1" } });
    renderUI(ui);
    expect(screen.getByText("Unknown officer (223e4567…)")).toBeInTheDocument();
  });

  it("looks the officer up in the tenant user directory by id, not the admin-only users list", async () => {
    fetchJsonMock.mockResolvedValue({ data: RECORD, source: "api" });
    await TsDetailPage({ params: { id: "ts-1" } });
    const urls = fetchJsonMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain(`/v1/identity/users/directory?ids=${RECORD.tsAuthorityId}`);
    expect(urls.some((u) => /\/identity\/users\?/.test(u))).toBe(false);
  });

  it("uses the work number and authority name the API already returns, with no extra lookups", async () => {
    fetchJsonMock.mockResolvedValue({ data: { ...RECORD, workNumber: "WK/2026/007", authorityName: "Anita Rao" }, source: "api" });
    const ui = await TsDetailPage({ params: { id: "ts-1" } });
    renderUI(ui);
    expect(screen.getByRole("link", { name: "WK/2026/007" })).toHaveAttribute("href", `/works/proposals/${RECORD.workId}`);
    expect(screen.getByText("Anita Rao")).toBeInTheDocument();
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
  });

  it("resolves the work number (linked to the proposal) and the officer NAME web-side (GAP-WORKS-APPROVALS-DETAIL-03)", async () => {
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url.includes("/works/proposals/")) return { data: { workNumber: "WK-2026-0042", description: "Canal" }, source: "api" };
      if (url.includes("/identity/users/directory")) return { data: [[RECORD.tsAuthorityId, "Superintending Engineer"]], source: "api" };
      return { data: RECORD, source: "api" };
    });
    const ui = await TsDetailPage({ params: { id: "x-1" } });
    renderUI(ui);
    const workLink = screen.getByRole("link", { name: "WK-2026-0042" });
    expect(workLink).toHaveAttribute("href", `/works/proposals/${RECORD.workId}`);
    expect(workLink).toHaveAttribute("title", RECORD.workId);
    expect(screen.getByText("Superintending Engineer")).toBeInTheDocument();
    expect(screen.queryByText(/Authority \(ID\)/)).not.toBeInTheDocument();
  });

  it("calls notFound() only for a definitive 404", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(TsDetailPage({ params: { id: "missing" } })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("shows a retryable load-error state (NOT a 404) when the fetch fails for a non-404 reason", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    const ui = await TsDetailPage({ params: { id: "ts-1" } });
    renderUI(ui);
    expect(screen.getByText(/could not load this record/i)).toBeInTheDocument();
  });

  it("disables Finalize for a user without an approver role", async () => {
    rolesMock.mockReturnValue(["works_viewer"]);
    fetchJsonMock.mockResolvedValue({ data: RECORD, source: "api" });
    const ui = await TsDetailPage({ params: { id: "ts-1" } });
    renderUI(ui);
    const btn = screen.getByRole("button", { name: "Finalize TS" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
