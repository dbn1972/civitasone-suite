import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import HrAuditLogPage from "./page";

async function renderPage(searchParams?: { page?: string; from?: string; to?: string; resourceType?: string; actor?: string }) {
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
    expect(screen.getByText(/You don't have permission to do this\. Ask your administrator if you need access\./)).toBeInTheDocument();
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

/**
 * GAP-HR-AUDIT-LOG-05/07/08: HR-scoped query, server-side resource type /
 * actor filters, "Type · id" resource text, and a link to the entity.
 */
describe("HrAuditLogPage — filters, scope and resource detail (GAP-HR-AUDIT-LOG-05/07/08)", () => {
  beforeEach(() => { mockRoles = ["audit_officer"]; fetchJsonMock.mockReset(); fetchJsonMock.mockResolvedValue({ data: [EVENT], source: "api" }); });

  it("always scopes the query to the HR services (08)", async () => {
    await renderPage();
    const [url] = fetchJsonMock.mock.calls[0] as [string];
    expect(new URL(url, "http://x").searchParams.get("service")).toBe("hrms,payroll");
  });

  it("forwards a known resourceType and an actor into the request (07)", async () => {
    await renderPage({ resourceType: "payroll_run", actor: "  asha@gov.in " });
    const [url] = fetchJsonMock.mock.calls[0] as [string];
    const sp = new URL(url, "http://x").searchParams;
    expect(sp.get("resourceType")).toBe("payroll_run");
    expect(sp.get("actor")).toBe("asha@gov.in");
  });

  it("ignores an unknown resourceType instead of forwarding it (07)", async () => {
    await renderPage({ resourceType: "not_a_type" });
    const [url] = fetchJsonMock.mock.calls[0] as [string];
    expect(new URL(url, "http://x").searchParams.has("resourceType")).toBe(false);
  });

  it("shows 'Type · id' and links an employee event to the employee page (05)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [{ ...EVENT, resourceType: "employee", resourceId: "11111111-2222-3333-4444-555555555555" }], source: "api" });
    await renderPage();
    expect(screen.getByText("Employee · 11111111-2222-3333-4444-555555555555")).toBeInTheDocument();
    const link = document.querySelector('a[href="/hr/employees/11111111-2222-3333-4444-555555555555"]');
    expect(link).not.toBeNull();
  });

  it("the loader's mapper keeps resourceType/resourceId from the raw audit-service row (05)", async () => {
    await renderPage();
    const opts = fetchJsonMock.mock.calls[0]![2] as { mapResponse: (p: unknown) => Array<{ resourceType?: string; resourceId?: string }> | null };
    const mapped = opts.mapResponse([{ actor: { email: "a@gov.in", actorId: "u1" }, type: "hrms.employee.update", target: "emp-9", payload: { resourceType: "employee", service: "hrms" }, severity: "info", occurredAt: "2026-09-29T10:15:00.000Z" }]);
    expect(mapped?.[0]).toMatchObject({ resourceType: "employee", resourceId: "emp-9" });
  });
});

/**
 * GAP-HR-AUDIT-LOG-04: real total, whole-trail default range, and a server-side
 * CSV export of every match (the page used to show only "Showing a-b", hid
 * everything older than 7 days until a From date was picked, and its CSV held
 * just the rows on screen).
 */
describe("HrAuditLogPage — total, whole-trail range and server export (GAP-HR-AUDIT-LOG-04)", () => {
  const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ ...EVENT, action: `hrms.employee.update.${i}` }));
  function route(list: unknown[], total: unknown, totalSource: "api" | "error" = "api") {
    fetchJsonMock.mockImplementation(async (url: string) =>
      url.includes("/events/count")
        ? { data: total, source: totalSource }
        : { data: list, source: "api" },
    );
  }
  const listUrl = () => new URL((fetchJsonMock.mock.calls[0] as [string])[0], "http://x");
  const countUrl = () => new URL((fetchJsonMock.mock.calls.find((c) => String(c[0]).includes("/events/count")) as [string])[0], "http://x");

  beforeEach(() => { mockRoles = ["audit_officer"]; fetchJsonMock.mockReset(); });

  it("with no From chosen, asks for the whole trail (epoch start) so events older than 7 days are not hidden", async () => {
    route([EVENT], 1);
    await renderPage();
    expect(listUrl().searchParams.get("from")).toBe("1970-01-01T00:00:00.000Z");
    expect(countUrl().searchParams.get("from")).toBe("1970-01-01T00:00:00.000Z");
  });

  it("a chosen From date still wins over the whole-trail default", async () => {
    route([EVENT], 1);
    await renderPage({ from: "2026-09-01" });
    expect(listUrl().searchParams.get("from")).toBe("2026-09-01T00:00:00.000Z");
    expect(countUrl().searchParams.get("from")).toBe("2026-09-01T00:00:00.000Z");
    // The default range is not a user filter: Clear only appears for a real one.
    expect(screen.getByRole("link", { name: "Clear" })).toBeInTheDocument();
  });

  it("with 120 events page 3 shows 101-120 of 120, reaches page 2 back, and has no Next", async () => {
    route(rowsOf(20), 120);
    await renderPage({ page: "3" });
    expect(screen.getByText("Showing 101–120 of 120")).toBeInTheDocument();
    expect(listUrl().searchParams.get("offset")).toBe("100");
    expect(screen.getByRole("link", { name: /previous/i })).toHaveAttribute("href", expect.stringContaining("page=2"));
    expect(screen.queryByRole("link", { name: /next/i })).not.toBeInTheDocument();
  });

  it("a full first page offers Next and states the real total", async () => {
    route(rowsOf(51), 120);
    await renderPage();
    expect(screen.getByText("Showing 1–50 of 120")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute("href", expect.stringContaining("page=2"));
  });

  it("asks for the total with exactly the list's filters (so the two can never disagree)", async () => {
    route([EVENT], 1);
    await renderPage({ from: "2026-09-01", to: "2026-09-30", resourceType: "payroll_run", actor: "asha@gov.in" });
    const strip = (u: URL) => { const p = new URLSearchParams(u.searchParams); p.delete("limit"); p.delete("offset"); return p.toString(); };
    expect(strip(countUrl())).toBe(strip(listUrl()));
    expect(countUrl().searchParams.get("service")).toBe("hrms,payroll");
    expect(countUrl().searchParams.get("resourceType")).toBe("payroll_run");
  });

  it("falls back to the range-only wording (no invented total) when the count cannot be read", async () => {
    route([EVENT], null, "error");
    await renderPage();
    expect(screen.getByText("Showing 1–1")).toBeInTheDocument();
    expect(screen.queryByText(/^Showing .* of /)).not.toBeInTheDocument();
  });

  it("offers a server-side CSV of ALL matching events carrying the current filters -- and no client-side CSV that holds only this page", async () => {
    route(rowsOf(51), 120);
    await renderPage({ from: "2026-09-01", resourceType: "payroll_run" });
    const link = screen.getByRole("link", { name: "Export all 120 matching events (CSV)" });
    const href = new URL(link.getAttribute("href")!, "http://x");
    expect(href.pathname).toBe("/api/proxy/audit/events/export");
    expect(href.searchParams.get("from")).toBe("2026-09-01T00:00:00.000Z");
    expect(href.searchParams.get("service")).toBe("hrms,payroll");
    expect(href.searchParams.get("resourceType")).toBe("payroll_run");
    // The export is not paged: no limit/offset leak into it.
    expect(href.searchParams.has("limit")).toBe(false);
    expect(href.searchParams.has("offset")).toBe(false);
    expect(screen.queryByRole("button", { name: /csv/i })).not.toBeInTheDocument();
  });

  it("explains instead of offering a download that the server would refuse when the match set is over the export cap", async () => {
    route(rowsOf(51), 60_000);
    await renderPage();
    expect(screen.queryByRole("link", { name: /export all/i })).not.toBeInTheDocument();
    expect(screen.getByText(/60000 events match, which is more than the 50000 one export can hold/)).toBeInTheDocument();
  });

  it("offers no export when nothing matches", async () => {
    route([], 0);
    await renderPage();
    expect(screen.queryByRole("link", { name: /export all/i })).not.toBeInTheDocument();
  });

  it("still offers Previous when the page is past the end, instead of stranding the auditor", async () => {
    route([], 120);
    await renderPage({ page: "9" });
    expect(screen.getByRole("link", { name: /previous/i })).toHaveAttribute("href", expect.stringContaining("page=8"));
  });
});

/**
 * GAP-HR-AUDIT-LOG-06: the outcome is a coloured StatusPill, and a row whose
 * outcome is not known renders neutral "Unknown", never green "Success".
 */
describe("HrAuditLogPage — outcome pill (GAP-HR-AUDIT-LOG-06)", () => {
  beforeEach(() => { mockRoles = ["audit_officer"]; fetchJsonMock.mockReset(); });

  it("renders success green, failure red and unknown neutral", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { ...EVENT, action: "a.success", outcome: "success" },
        { ...EVENT, action: "a.failure", outcome: "failure" },
        { ...EVENT, action: "a.unknown", outcome: "unknown" },
      ],
      source: "api",
    });
    await renderPage();
    const pill = (action: string) => within(screen.getByText(action).closest("tr") as HTMLElement).getByText(/^(Success|Failure|Unknown)$/);
    expect(pill("a.success")).toHaveTextContent("Success");
    expect(pill("a.success")).toHaveClass("pill", "good");
    expect(pill("a.failure")).toHaveTextContent("Failure");
    expect(pill("a.failure")).toHaveClass("pill", "bad");
    expect(pill("a.unknown")).toHaveTextContent("Unknown");
    expect(pill("a.unknown")).toHaveClass("pill", "mut");
    expect(pill("a.unknown")).not.toHaveClass("good");
  });
});
