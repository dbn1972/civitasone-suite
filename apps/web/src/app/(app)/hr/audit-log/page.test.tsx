import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import HrAuditLogPage from "./page";

async function renderPage(searchParams?: { page?: string; from?: string; to?: string }) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await HrAuditLogPage({ searchParams })}
    </NextIntlClientProvider>,
  );
}

const EVENT = { actor: "a@gov.in", action: "hrms.employee.update", resource: "emp-1", outcome: "success" as const, at: "2026-09-29T10:15:00.000Z" };

describe("HrAuditLogPage — role gating", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ data: [EVENT], source: "api" });
  });

  it("shows PermissionDenied for a role without audit access (e.g. plain hr_admin)", async () => {
    mockRoles = ["hr_admin"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders the log for audit_officer", async () => {
    mockRoles = ["audit_officer"];
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    expect(screen.getByText("hrms.employee.update")).toBeInTheDocument();
  });
});

/**
 * GAP-HR-AUDIT-LOG-01/02: an empty-but-valid tenant must show the honest
 * empty state, and a genuine fetch failure must show a real error state --
 * previously both an outage AND "nothing has happened yet" rendered the
 * exact same empty-state copy, telling an auditor there were no events when
 * the truth might be "we don't know".
 */
describe("HrAuditLogPage — empty vs. error (GAP-HR-AUDIT-LOG-01/02)", () => {
  beforeEach(() => { mockRoles = ["audit_officer"]; fetchJsonMock.mockReset(); });

  it("shows the honest empty state when there are genuinely no events", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("No audit records")).toBeInTheDocument();
  });

  it("shows a real error state -- not the empty state -- when the fetch fails", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    await renderPage();
    expect(screen.queryByText("No audit records")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
  });

  it("shows PermissionDenied (not a generic retry state) on a live 403 from audit-service", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 403, errorMessage: "audit trail access is restricted" });
    await renderPage();
    expect(screen.getByText(/audit trail access is restricted/i)).toBeInTheDocument();
  });
});

/**
 * GAP-HR-AUDIT-LOG-04: pagination previously never existed at all -- only
 * the first 50 events were ever reachable, forever.
 */
describe("HrAuditLogPage — pagination (GAP-HR-AUDIT-LOG-04)", () => {
  beforeEach(() => { mockRoles = ["audit_officer"]; fetchJsonMock.mockReset(); });

  it("shows a Next link when more than a page of events is available, and requests page-size+1", async () => {
    const events = Array.from({ length: 51 }, (_, i) => ({ ...EVENT, action: `hrms.employee.update.${i}` }));
    fetchJsonMock.mockResolvedValue({ data: events, source: "api" });
    await renderPage();
    expect(screen.getByRole("link", { name: /next/i })).toBeInTheDocument();
    const [url] = fetchJsonMock.mock.calls[0] as [string];
    expect(url).toContain("limit=51");
  });

  it("shows no Next link when the fetched page is not full", async () => {
    fetchJsonMock.mockResolvedValue({ data: [EVENT], source: "api" });
    await renderPage();
    expect(screen.queryByRole("link", { name: /next/i })).not.toBeInTheDocument();
  });

  it("shows a Previous link (not Next) on page 2 with no further data", async () => {
    fetchJsonMock.mockResolvedValue({ data: [EVENT], source: "api" });
    await renderPage({ page: "2" });
    expect(screen.getByRole("link", { name: /previous/i })).toBeInTheDocument();
  });

  it("forwards from/to date filters into the request URL", async () => {
    fetchJsonMock.mockResolvedValue({ data: [EVENT], source: "api" });
    await renderPage({ from: "2026-09-01", to: "2026-09-30" });
    const [url] = fetchJsonMock.mock.calls[0] as [string];
    expect(url).toContain("from=2026-09-01T00%3A00%3A00.000Z");
    expect(url).toContain("to=2026-09-30T23%3A59%3A59.999Z");
  });
});

/**
 * GAP-HR-AUDIT-LOG-05: a row whose resource couldn't be identified used to
 * leak the mapper's internal "unknown" sentinel verbatim; now shown as a
 * translated, honest label at the page layer.
 */
describe("HrAuditLogPage — unknown resource label (GAP-HR-AUDIT-LOG-05)", () => {
  it("renders a friendly label instead of the raw 'unknown' sentinel", async () => {
    mockRoles = ["audit_officer"];
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ data: [{ ...EVENT, resource: "unknown" }], source: "api" });
    await renderPage();
    expect(screen.getByText("Unknown resource")).toBeInTheDocument();
  });
});
