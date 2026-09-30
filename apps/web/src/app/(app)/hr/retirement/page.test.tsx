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
// PR #1715 review follow-up: pulled out to a plain top-level mock (same safe
// shape as fetchJsonMock just above -- the factory only closes over it
// inside a nested arrow function, so no vi.hoisted TDZ hazard) so the
// restored ?empId= tests below can reconfigure its return value per test,
// the same way they reconfigure fetchJsonMock.
// Bare vi.fn() (no inline implementation), matching fetchJsonMock's own
// declaration style just above -- vi.fn(impl) would narrow the inferred
// call signature to impl's exact param list (zero params here), which then
// rejects `getEmployeeByIdMock(...args)` below ("spread argument must have
// a tuple type"). Never called with no override anyway: every test except
// the two ?empId= ones below renders with no prefillEmployeeId, so
// page.tsx's `prefillEmployeeId ? await getEmployeeById(...) : null` never
// invokes it for them.
const getEmployeeByIdMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getEmployeeById: (...args: unknown[]) => getEmployeeByIdMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import RetirementPage from "./page";

async function renderPage(props: Parameters<typeof RetirementPage>[0] = {}) {
  const page = await RetirementPage(props);
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ToastProvider>{page}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sep-1",
    employee: "Priya Nair",
    department: "Finance",
    designation: "Section Officer",
    superannuationDate: "2027-01-01",
    separationType: "retirement",
    status: "initiated",
    joiningDate: "1995-01-01",
    ...overrides,
  };
}

// GAP-HR-RETIREMENT-06: no client-side role check existed at all.
describe("RetirementPage role gate (GAP-HR-RETIREMENT-06)", () => {
  it("shows PermissionDenied for a plain employee and issues no fetch", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders normally for hr_officer", async () => {
    getSessionRolesMock.mockReturnValue(["hr_officer"]);
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByRole("heading", { name: "Retirement & Separation" })).toBeInTheDocument();
  });
});

describe("RetirementPage stats (GAP-HR-RETIREMENT-03)", () => {
  it("counts lowercase 'vrs' correctly (was compared against uppercase 'VRS', always 0)", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({
      data: [row({ id: "s1", separationType: "vrs" }), row({ id: "s2", separationType: "retirement" })],
      source: "api",
    });
    await renderPage();
    expect(screen.getByText("VRS").closest(".stat")).toHaveTextContent("1");
  });

  it("shows an 'Initiated' stat (not 'Processed', which nothing ever sets to 'completed')", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({
      data: [row({ id: "s1", status: "initiated" }), row({ id: "s2", status: "initiated" })],
      source: "api",
    });
    await renderPage();
    // "Initiated" also appears per-row in the register's status column, so
    // scope to the stat-grid label specifically (rendered before the
    // register in document order).
    expect(screen.getAllByText("Initiated")[0].closest(".stat")).toHaveTextContent("2");
  });
});

// Restored (PR #1715 review follow-up): dropped without comment when this
// file was rewritten for the role gate above. The underlying behavior is
// confirmed unchanged (DataSourceBadge still renders this exact message
// prop on source: "error" -- see _components/DataSourceBadge.tsx); only the
// harness needed updating, same as every other test in this file, to pass
// an allowed role now that the gate exists.
describe("RetirementPage data state", () => {
  it("tells the truth on a fetch failure instead of the old 'Showing saved information' copy", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByText("Couldn't load retirement records — showing nothing")).toBeInTheDocument();
  });
});

// Restored (PR #1715 review follow-up): dropped without comment when this
// file was rewritten for the role gate above.
//
// SEC CRITICAL regression (originally PR #1572 fix-up round): a direct
// navigation to /hr/retirement?empId=<already-exited-id> used to reach a
// fully pre-filled, submittable separation form. This page fetches the full
// employee record for the name already (getEmployeeById) and threads its
// status through to InitiateSeparationAction so the guarded "already
// exited" state renders instead. InitiateSeparationAction.test.tsx covers
// the guard logic itself (still has its own "already exited"/"SEC CRITICAL"
// tests, unaffected by this PR); these two prove the wiring through THIS
// page actually reaches it -- confirmed still intact and unchanged
// (prefillEmployeeId/Name/Status threaded to <InitiateSeparationAction> at
// page.tsx:108), so only the harness below needed updating, not the
// assertions themselves.
describe("RetirementPage ?empId= prefill wiring (SEC CRITICAL regression guard)", () => {
  it("?empId= for an already-exited employee renders the guarded notice, not a submittable form", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    getEmployeeByIdMock.mockResolvedValueOnce({ data: { id: "emp-exited", name: "Already Gone", status: "retired" } });

    await renderPage({ searchParams: { empId: "emp-exited" } });

    expect(screen.getByText("Already Gone has already exited (status: retired) and cannot be separated again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Initiate Separation" })).not.toBeInTheDocument();
  });

  it("?empId= for a non-exited employee still prefills the normal submittable form", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    getEmployeeByIdMock.mockResolvedValueOnce({ data: { id: "emp-active", name: "Still Serving", status: "confirmed" } });

    await renderPage({ searchParams: { empId: "emp-active" } });

    expect(screen.getByRole("button", { name: "+ Initiate Separation" })).toBeInTheDocument();
    expect(screen.queryByText(/has already exited/)).not.toBeInTheDocument();
  });
});
