import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["super_admin"] }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/tenants/11111111-aaaa-4000-8000-000000000001",
  useSearchParams: () => new URLSearchParams(),
}));

import TenantDetailPage from "./page";

function detailFails(status: number, errorMessage?: string) {
  fetchJsonMock.mockImplementation((...args: unknown[]) => { const path = String(args[0] ?? "");
    if (path.endsWith("/config")) return Promise.resolve({ data: [], source: "error", status });
    return Promise.resolve({ data: null, source: "error", status, ...(errorMessage ? { errorMessage } : {}) });
  });
}

const TID = "11111111-aaaa-4000-8000-000000000001";

async function renderPage() {
  const page = await TenantDetailPage({ params: Promise.resolve({ id: TID }) });
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{page}</NextIntlClientProvider>);
}

// GAP-ADMIN-TENANTS-DETAIL-01: only a real 404 may say "Tenant not found".
describe("TenantDetailPage failure states", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("404 -> Tenant not found", async () => {
    detailFails(404);
    await renderPage();
    expect(screen.getByText("Tenant not found")).toBeInTheDocument();
  });

  it("500 -> load error with retry, not 'Tenant not found'", async () => {
    detailFails(500);
    await renderPage();
    expect(screen.queryByText("Tenant not found")).not.toBeInTheDocument();
    expect(screen.queryByText(/may have been removed/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry|refresh/i })).toBeInTheDocument();
  });

  it("403 -> Access restricted", async () => {
    detailFails(403, "requires one of: super_admin, platform_admin");
    await renderPage();
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(screen.queryByText("Tenant not found")).not.toBeInTheDocument();
  });

  it("success renders the tenant", async () => {
    fetchJsonMock.mockImplementation((...args: unknown[]) => { const path = String(args[0] ?? "");
      if (path.endsWith("/config")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: { name: "Acme Board", edition: "PSU", status: "active", region: "ap-south-1" }, source: "api" });
    });
    await renderPage();
    expect(screen.getByText("Tenant: Acme Board")).toBeInTheDocument();
  });
});

// GAP-ADMIN-TENANTS-DETAIL-03/04/05
describe("TenantDetailPage hardening", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("a non-uuid / traversal id is notFound and never reaches the upstream", async () => {
    await expect(TenantDetailPage({ params: Promise.resolve({ id: "../users" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("module seats tile is labelled as seats, shows the domain and an onboarding link", async () => {
    fetchJsonMock.mockImplementation((...args: unknown[]) => { const path = String(args[0] ?? "");
      if (path.endsWith("/config")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: { name: "Acme Board", domain: "acme.gov.in", edition: "PSU", status: "active", region: "ap-south-1", settings: { theme: "blue" } }, source: "api" });
    });
    await renderPage();
    expect(screen.queryByText("Active Users")).not.toBeInTheDocument();
    expect(screen.getByText("Module seats in use")).toBeInTheDocument();
    expect(screen.getByText(/Domain: acme\.gov\.in/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Onboarding queue" })).toHaveAttribute("href", "/admin/onboarding");
    // GAP2-ADMIN-TENANTS-DETAIL-01: settings keys are now human-labelled
    // (title-cased), not shown as the raw jsonb key; the value is still shown.
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("blue")).toBeInTheDocument();
  });
});

// GAP-ADMIN-TENANTS-DETAIL-05 (remainder): lifecycle actions, requests panel, approval policy.
describe("TenantDetailPage lifecycle", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  const tenant = { name: "Acme Board", domain: "acme.gov.in", edition: "psu", status: "active", region: "ap-south-1", settings: {} };
  const pending = {
    id: "22222222-aaaa-4000-8000-000000000002", kind: "suspend", status: "pending", reason: "Dues unpaid", payload: {}, effectiveAt: null,
    requestedAt: "2026-10-03T06:00:00Z", requestedByYou: false, requiredApprovals: 1, approvalsCount: 0,
    decidedAt: null, decidedByYou: false, decisionReason: null, failureCode: null, directExecution: false, canDecide: true,
  };
  const policyView = {
    policy: { requiresSecondApprover: true, approverRoles: ["super_admin", "platform_admin"], minApprovals: 1, reasonRequired: true, notifyTenantAdmins: true },
    isDefault: true, pendingChange: null,
  };

  function mockOk(over: { requests?: unknown; requestsSource?: string; policySource?: string } = {}) {
    fetchJsonMock.mockImplementation((...args: unknown[]) => { const path = String(args[0] ?? "");
      if (path.endsWith("/config")) return Promise.resolve({ data: [], source: "api" });
      if (path.includes("/lifecycle-requests")) return Promise.resolve({ data: over.requests ?? [pending], source: over.requestsSource ?? "api" });
      if (path.endsWith("/approval-policy")) return Promise.resolve({ data: policyView, source: over.policySource ?? "api" });
      return Promise.resolve({ data: tenant, source: "api" });
    });
  }

  it("shows the lifecycle actions, the pending request with Approve/Reject, and the approval policy card", async () => {
    mockOk();
    await renderPage();
    // a suspension is already awaiting approval, so a second one cannot be started
    expect(screen.queryByRole("button", { name: "Suspend tenant" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByText("Approval policy")).toBeInTheDocument();
    // status badge shows the catalogued label, not the raw enum
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
  });

  it("a failed requests load is an error, never an empty list", async () => {
    mockOk({ requests: [], requestsSource: "error" });
    await renderPage();
    expect(screen.getByText(/lifecycle requests could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText(/No lifecycle requests/)).not.toBeInTheDocument();
  });

  it("a failed policy load disables policy editing instead of showing defaults", async () => {
    mockOk({ policySource: "error" });
    await renderPage();
    expect(screen.getByText(/approval policy could not be loaded/)).toBeInTheDocument();
  });
});
