import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ToastProvider } from "@/app/_components/ds";

const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn(() => ["hr_admin"]) }));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: getSessionRolesMock,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import SuccessionPage from "./page";

async function renderPage() {
  const page = await SuccessionPage();
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ToastProvider>{page}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

function mockThreeCalls(opts: {
  pipeline?: { data: unknown[]; source?: "api" | "error"; status?: number; errorMessage?: string };
  risk?: { data: unknown[]; source?: "api" | "error"; status?: number; errorMessage?: string };
  departments?: { data: unknown[] };
}) {
  fetchJsonMock.mockImplementation((path: string) => {
    if (path.includes("/succession/pipeline")) {
      return Promise.resolve({ data: [], source: "api", ...opts.pipeline });
    }
    if (path.includes("/succession/risk")) {
      return Promise.resolve({ data: [], source: "api", ...opts.risk });
    }
    return Promise.resolve({ data: [], source: "api", ...opts.departments });
  });
}

// GAP-HR-SUCCESSION-05: the page previously had no client-side role check
// at all (unlike sibling pages such as rti/page.tsx), so a non-HR role
// admitted by hr/layout.tsx fell through to a raw 403/error surface
// instead of an honest PermissionDenied. NOT a change to who has server
// access -- gap-features/routes.ts already enforces hr_admin/hr_officer/
// super_admin on every succession route; verified directly against that
// file before making this change.
describe("SuccessionPage role gate (GAP-HR-SUCCESSION-05)", () => {
  it("shows PermissionDenied for a plain employee and issues no fetch", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    mockThreeCalls({});
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders normally for hr_officer (already server-side authorised today)", async () => {
    getSessionRolesMock.mockReturnValue(["hr_officer"]);
    mockThreeCalls({});
    await renderPage();
    expect(screen.getByRole("heading", { name: "Succession Planning" })).toBeInTheDocument();
  });
});

describe("SuccessionPage stats (GAP-HR-SUCCESSION-04)", () => {
  it("shows '—' for pipeline-derived stats when the pipeline call errors, independent of the risk call", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    mockThreeCalls({ pipeline: { data: [], source: "error" }, risk: { data: [{ role_ref: "X", department: "Y" }] } });
    await renderPage();
    expect(screen.getByText("Critical Roles").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Roles at Risk").closest(".stat")).toHaveTextContent("1");
  });

  it("shows the at-risk table's own error state when only the risk call fails, without hiding the pipeline cards", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    mockThreeCalls({
      pipeline: { data: [{ planId: "p1", role_ref: "Chief Test Officer", department: "Test Dept", nominee_count: 1, ready_now: 1, riskLevel: "medium", successors: [{ employeeId: "e1", name: "Priya Nair", readiness: "ready_now" }] }] },
      risk: { data: [], source: "error", status: 500 },
    });
    await renderPage();
    expect(screen.getByRole("heading", { name: "Chief Test Officer" })).toBeInTheDocument();
    expect(screen.getByText("Roles at Risk").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  // GAP-HR-SUCCESSION-04: the at-risk table's own "all ready" empty state
  // was previously unreachable (`atRisk.length > 0 &&` wrapped the whole
  // card).
  it("shows the all-ready empty state when the risk call succeeds with zero rows", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    mockThreeCalls({ risk: { data: [] } });
    await renderPage();
    expect(screen.getByText("All critical roles have ready successors")).toBeInTheDocument();
  });
});

// GAP-HR-SUCCESSION-02: the card header and the at-risk table used to print
// the raw department_id UUID; the API now sends the department NAME and the
// page must show only that.
describe("SuccessionPage department names (GAP-HR-SUCCESSION-02)", () => {
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const DEPT_ID = "5c1d3b6e-8f0a-4c2e-9d11-0a1b2c3d4e5f";

  it("shows 'Finance' in the at-risk table for a row carrying a department_id UUID, and no UUID anywhere", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    mockThreeCalls({
      risk: { data: [{ role_ref: "Chief Accountant", department_id: DEPT_ID, department: "Finance" }] },
    });
    const { container } = await renderPage();
    const cell = screen.getByRole("cell", { name: "Finance" });
    expect(cell).toBeInTheDocument();
    expect(container.textContent).toContain("Finance");
    expect(container.textContent).not.toMatch(UUID_RE);
  });

  it("shows a dash, not the UUID, for an at-risk row whose department could not be resolved", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    mockThreeCalls({
      risk: { data: [{ role_ref: "Chief Accountant", department_id: DEPT_ID }] },
    });
    const { container } = await renderPage();
    expect(screen.getByRole("cell", { name: "—" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(UUID_RE);
  });

  it("shows the department name in the pipeline card header and never the id", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    mockThreeCalls({
      pipeline: {
        data: [{
          planId: "0b7d9f22-1111-4222-8333-444455556666", role_ref: "Chief Accountant", department_id: DEPT_ID, department: "Finance",
          nominee_count: 1, ready_now: 1, riskLevel: "medium",
          successors: [{ employeeId: "9f8e7d6c-1111-4222-8333-444455556666", name: "Priya Nair", readiness: "ready_now", developmentPlan: "Rotate through Treasury" }],
        }],
      },
    });
    const { container } = await renderPage();
    const card = screen.getByRole("heading", { name: "Chief Accountant" }).closest("article");
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent("Finance");
    // the recorded plan reaches the card, so the successor is not shown as "No plan"
    expect(card).toHaveTextContent("Rotate through Treasury");
    expect(card).not.toHaveTextContent("No plan");
    expect(container.textContent).not.toMatch(UUID_RE);
  });
});
