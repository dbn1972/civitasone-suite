import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const getTenantAuditLogMock = vi.fn();
vi.mock("../../../_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("../../../_data/loaders")>("../../../_data/loaders");
  return { ...actual, getTenantAuditLog: (...a: unknown[]) => getTenantAuditLogMock(...a) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import TenantAuditPage from "./page";

const EVENTS = [
  { id: "1", timestamp: new Date().toISOString(), actor: "a@b.in", ipAddress: "10.0.0.1", action: "login", resource: null, outcome: "success" },
  { id: "2", timestamp: new Date().toISOString(), actor: "c@d.in", ipAddress: "10.0.0.2", action: "login", resource: null, outcome: "failure" },
];

describe("TenantAuditPage", () => {
  beforeEach(() => getTenantAuditLogMock.mockReset());

  it("GAP-TENANT-ADMIN-AUDIT-05: a failed load shows a retry state and '—' KPIs, not zeros", async () => {
    getTenantAuditLogMock.mockResolvedValue({ data: [], source: "error" });
    render(await TenantAuditPage({}));
    expect(screen.getByText(/couldn't load audit events/i)).toBeInTheDocument();
    expect(screen.getByText("Loaded events").closest(".stat")).toHaveTextContent("—");
  });

  it("GAP-TENANT-ADMIN-AUDIT-02: there is no dead 'Filter' control", async () => {
    getTenantAuditLogMock.mockResolvedValue({ data: EVENTS, source: "api" });
    render(await TenantAuditPage({}));
    expect(screen.queryByText(/\(coming soon\)/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Filter/i })).not.toBeInTheDocument();
  });

  it("GAP-TENANT-ADMIN-AUDIT-04: the total KPI is labelled 'Loaded events' (honest about pagination)", async () => {
    getTenantAuditLogMock.mockResolvedValue({ data: EVENTS, source: "api" });
    render(await TenantAuditPage({}));
    expect(screen.getByText("Loaded events").closest(".stat")).toHaveTextContent("2");
    expect(screen.queryByText("Total Events")).not.toBeInTheDocument();
  });
});

// GAP-TENANT-ADMIN-NOTIFICATIONS-03: the "Audit changes" link from the
// notification-preferences page deep-links here with ?entity=notification-prefs
// and the page must scope the list + KPIs to the preference-change events.
const PREF_EVENTS = [
  { id: "p1", timestamp: new Date().toISOString(), actor: "admin", ipAddress: "10.0.0.1", action: "update_prefs", resource: "pref-1", outcome: "success" },
  { id: "p2", timestamp: new Date().toISOString(), actor: "admin", ipAddress: "10.0.0.2", action: "set_prefs", resource: "pref-2", outcome: "success" },
  { id: "p3", timestamp: new Date().toISOString(), actor: "admin", ipAddress: "10.0.0.3", action: "login", resource: "session", outcome: "success" },
];

describe("TenantAuditPage — notification-prefs entity filter", () => {
  beforeEach(() => getTenantAuditLogMock.mockReset());

  it("without the filter shows every action", async () => {
    getTenantAuditLogMock.mockResolvedValue({ data: PREF_EVENTS, source: "api" });
    render(await TenantAuditPage({}));
    const table = screen.getByRole("table");
    expect(within(table).getByText("login")).toBeInTheDocument();
    expect(within(table).getByText("update_prefs")).toBeInTheDocument();
  });

  it("with ?entity=notification-prefs shows only pref-change events + a scope notice", async () => {
    getTenantAuditLogMock.mockResolvedValue({ data: PREF_EVENTS, source: "api" });
    render(await TenantAuditPage({ searchParams: { entity: "notification-prefs" } }));
    const table = screen.getByRole("table");
    expect(within(table).getByText("update_prefs")).toBeInTheDocument();
    expect(within(table).getByText("set_prefs")).toBeInTheDocument();
    expect(within(table).queryByText("login")).not.toBeInTheDocument();
    expect(screen.getByText(/Showing notification-preference changes only/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Show all audit events/i })).toHaveAttribute("href", "/tenant-admin/audit");
    expect(screen.getByText("Loaded events").closest(".stat")).toHaveTextContent("2");
  });
});
