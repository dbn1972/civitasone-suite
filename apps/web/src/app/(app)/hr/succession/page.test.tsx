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
