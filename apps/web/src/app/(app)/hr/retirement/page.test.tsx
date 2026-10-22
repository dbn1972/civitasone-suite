import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ToastProvider } from "@/app/_components/ds";
import { todayDateOnly } from "@/lib/retirement";

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

// GAP-HR-RETIREMENT-05: the page KPIs, the card dashboard and the wizard all read
// one shared partition (lib/retirement partitionRetirements), so the numbers on the
// KPI strip are exactly the numbers the dashboard reports and the cards it renders.
function daysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe("RetirementPage KPIs agree with the dashboard (GAP-HR-RETIREMENT-05)", () => {
  it("'Next 6 Months' and 'Overdue' equal the dashboard's own counts, and completed past rows are in neither", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({
      data: [
        row({ id: "u1", employee: "Upcoming One", superannuationDate: daysFromNow(20) }),
        row({ id: "u2", employee: "Upcoming Two", superannuationDate: daysFromNow(90) }),
        row({ id: "o1", employee: "Overdue One", superannuationDate: daysFromNow(-12), status: "initiated" }),
        row({ id: "done", employee: "Completed Past", superannuationDate: daysFromNow(-40), status: "completed" }),
      ],
      source: "api",
    });
    await renderPage();

    expect(screen.getByText("Next 6 Months").closest(".stat")).toHaveTextContent("2");
    expect(screen.getByText("Overdue").closest(".stat")).toHaveTextContent("1");
    // The dashboard states the same two numbers...
    expect(screen.getByText("2 due in the next 6 months · 1 overdue")).toBeInTheDocument();
    // ...and renders exactly that many case cards (the completed past row is not one of them).
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByRole("article", { name: "Retirement: Overdue One" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Retirement: Completed Past" })).not.toBeInTheDocument();
  });

  it("the Overdue KPI is 0 and the summary line says so when nothing is overdue", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({ data: [row({ id: "u1", superannuationDate: daysFromNow(10) })], source: "api" });
    await renderPage();
    expect(screen.getByText("Overdue").closest(".stat")).toHaveTextContent("0");
    expect(screen.getByText("1 due in the next 6 months · 0 overdue")).toBeInTheDocument();
  });

  it("an effective date of today counts as upcoming, not overdue", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({ data: [row({ id: "t1", superannuationDate: todayDateOnly() })], source: "api" });
    await renderPage();
    expect(screen.getByText("Next 6 Months").closest(".stat")).toHaveTextContent("1");
    expect(screen.getByText("Overdue").closest(".stat")).toHaveTextContent("0");
  });
});

describe("RetirementPage shell copy comes from the message catalogue (GAP-HR-RETIREMENT-08)", () => {
  it("renders the translated back link", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText(enMessages.retirement.backLabel)).toBeInTheDocument();
  });

  it("renders the translated load-failure message", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByText(enMessages.retirement.loadErrorMessage)).toBeInTheDocument();
  });
});
