import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Only the session is stubbed -- PAYROLL_REPORT_ROLES / PAYROLL_ADMIN_ROLES
// are the REAL constants, so drift between them and payroll-service's
// salary-revisions GET/POST role lists shows up here (PR #1756 review H2).
const getSessionRolesMock = vi.fn();
vi.mock("@/lib/auth/roleGuard", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard")),
  getSessionRoles: () => getSessionRolesMock(),
}));

import SalaryRevisionsPage from "./page";

// UX-017 (PR #1552 review): SalaryRevisionsPage is a server component
// (translated via getTranslations(), which vitest.setup.ts mocks centrally --
// no provider needed just for that call), but it also renders
// CreateSalaryRevisionForm, a CLIENT component that calls useTranslations().
// That child needs a genuine NextIntlClientProvider in the tree.
async function renderPage() {
  const ui = await SalaryRevisionsPage();
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const E1 = "11111111-1111-4111-8111-111111111101";
const E2 = "11111111-1111-4111-8111-111111111102";
const E_UNKNOWN = "99999999-9999-4999-8999-999999999999";

// page.tsx fetches the revisions, then resolves employee names through the
// shared hrms directory `ids=` batch (resolveEmployeeNames). Route each
// mocked fetchJson call by path.
function mockRevisionsAndNames(
  revisions: Record<string, unknown>[],
  revisionsSource: "api" | "error" = "api",
  names: Array<[string, { name: string; employeeNo: string | null }]> = [],
) {
  fetchJsonMock.mockImplementation((path: string) =>
    Promise.resolve(
      path.startsWith("/api/v1/hrms/employees")
        ? { data: names, source: "api" }
        : { data: revisions, source: revisionsSource },
    ),
  );
}

function rev(overrides: Record<string, unknown> = {}) {
  return {
    id: "sr1", employee_id: E1, effective_date: "2026-04-01",
    old_basic_minor: 4000000, new_basic_minor: 4400000,
    old_gross_minor: 8000000, new_gross_minor: 8800000,
    revision_type: "annual_increment", order_no: "ORD-1",
    ...overrides,
  };
}

describe("SalaryRevisionsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("renders the list of salary revisions", async () => {
    mockRevisionsAndNames([rev()]);
    await renderPage();
    expect(screen.getAllByText("Annual Increment").length).toBeGreaterThan(0);
  });

  // GAP-PAYROLL-SALARY-REVISIONS-03 / PR #1756 review H3: names come from
  // the shared batch resolver, not a 500-row getEmployees() directory pull.
  it("shows the employee's name and number from the shared ids= batch lookup", async () => {
    mockRevisionsAndNames([rev()], "api", [[E1, { name: "Asha Verma", employeeNo: "EMP-0042" }]]);
    await renderPage();
    expect(screen.getByText("Asha Verma (EMP-0042)")).toBeInTheDocument();
    const paths = fetchJsonMock.mock.calls.map(([p]) => String(p));
    expect(paths.some((p) => p.startsWith("/api/v1/hrms/employees?ids=") && p.includes(E1))).toBe(true);
    expect(paths.some((p) => /limit=500/.test(p))).toBe(false);
  });

  it("falls back to 'Unknown employee · <id prefix>' when the directory has no match", async () => {
    mockRevisionsAndNames([rev({ employee_id: E_UNKNOWN })]);
    await renderPage();
    expect(screen.getByText("Unknown employee · 99999999")).toBeInTheDocument();
  });

  // GAP-PAYROLL-SALARY-REVISIONS-01: "correction" and "fitment" used to fall
  // through to the raw backend code.
  it("shows a humanised label for 'correction' and 'fitment', not the raw code", async () => {
    mockRevisionsAndNames([
      rev({ revision_type: "correction", new_basic_minor: 4000000, new_gross_minor: 8000000, order_no: null }),
      rev({ id: "sr2", employee_id: E2, revision_type: "fitment", order_no: null }),
    ]);
    await renderPage();
    // Also present as <option> text in the create form on this page.
    expect(screen.getAllByText("Correction").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fitment").length).toBeGreaterThan(0);
    expect(screen.queryByText("correction")).not.toBeInTheDocument();
    expect(screen.queryByText("fitment")).not.toBeInTheDocument();
  });

  // PR #1756 review L1: legacy DB-valid codes keep a readable label.
  it("shows readable labels for legacy codes (special / pay_commission / market_correction)", async () => {
    mockRevisionsAndNames([
      rev({ id: "a", revision_type: "special" }),
      rev({ id: "b", revision_type: "pay_commission" }),
      rev({ id: "c", revision_type: "market_correction" }),
    ]);
    await renderPage();
    expect(screen.getByText("Special")).toBeInTheDocument();
    expect(screen.getByText("Pay Commission")).toBeInTheDocument();
    expect(screen.getByText("Market Correction")).toBeInTheDocument();
    expect(screen.queryByText("pay_commission")).not.toBeInTheDocument();
  });

  it("shows a Corrections stat, not the old always-zero Pay Commission one", async () => {
    mockRevisionsAndNames([rev({ revision_type: "correction" })]);
    await renderPage();
    expect(screen.getByText("Corrections")).toBeInTheDocument();
    expect(screen.queryByText("Pay Commission")).not.toBeInTheDocument();
  });

  // GAP-PAYROLL-SALARY-REVISIONS-04: old gross + a signed gross change.
  it("shows the old gross and a signed gross-change column (increase and decrease)", async () => {
    mockRevisionsAndNames([
      rev(),
      rev({ id: "sr2", employee_id: E2, revision_type: "correction", old_gross_minor: 8800000, new_gross_minor: 8000000 }),
    ]);
    await renderPage();
    expect(screen.getByText("Old Gross")).toBeInTheDocument();
    expect(screen.getByText("Gross Change")).toBeInTheDocument();
    expect(screen.getByText("+₹8,000.00")).toBeInTheDocument();
    expect(screen.getByText(/^-₹8,000\.00$|^−₹8,000\.00$|^₹-8,000\.00$/)).toBeInTheDocument();
  });

  // PR #1756 review B1: DataTable is "use client"; a render: function from
  // this Server Component crashes the page at runtime. The jsdom render
  // above never crosses the RSC boundary, so assert the props directly.
  it("passes DataTable only serialisable column definitions (no render functions)", async () => {
    mockRevisionsAndNames([rev()]);
    const ui = await SalaryRevisionsPage();
    const found: unknown[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      const el = node as { props?: { columns?: unknown; children?: unknown; rowHref?: unknown } };
      if (el.props?.columns) found.push(el.props);
      if (el.props?.children) walk(el.props.children);
    };
    walk(ui);
    expect(found).toHaveLength(1);
    const props = found[0] as { columns: Record<string, unknown>[]; rowHref?: unknown };
    expect(props.rowHref).toBeUndefined();
    for (const col of props.columns) {
      for (const v of Object.values(col)) expect(typeof v).not.toBe("function");
    }
  });

  it("renders an empty state when there are no revisions", async () => {
    mockRevisionsAndNames([]);
    await renderPage();
    expect(screen.getByText("No salary revisions yet")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    mockRevisionsAndNames([], "error");
    await renderPage();
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  // GAP-PAYROLL-SALARY-REVISIONS-05 / PR #1756 review H2: the page gate
  // mirrors GET /v1/payroll/salary-revisions (world-class-routes.ts ROLES:
  // payroll_admin, payroll_officer, super_admin, hr_admin).
  it.each([["employee"], ["manager"], ["finance_officer"]])(
    "shows PermissionDenied to a %s session and never calls the data loaders",
    async (role) => {
      getSessionRolesMock.mockReturnValue([role]);
      await renderPage();
      expect(screen.getByText("Access restricted")).toBeInTheDocument();
      expect(fetchJsonMock).not.toHaveBeenCalled();
    },
  );

  // The form mirrors POST (payroll_admin, payroll_officer, super_admin).
  it.each([["payroll_admin"], ["payroll_officer"], ["super_admin"]])(
    "shows the history AND the create form to a %s session",
    async (role) => {
      getSessionRolesMock.mockReturnValue([role]);
      mockRevisionsAndNames([]);
      await renderPage();
      expect(screen.queryByText("Access restricted")).not.toBeInTheDocument();
      expect(screen.getByText("Salary Revision History")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Record Revision" })).toBeInTheDocument();
    },
  );

  it("shows the history but NOT the create form to an hr_admin session (backend POST excludes hr_admin)", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    mockRevisionsAndNames([rev()]);
    await renderPage();
    expect(screen.queryByText("Access restricted")).not.toBeInTheDocument();
    expect(screen.getByText("Salary Revision History")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record Revision" })).not.toBeInTheDocument();
  });
});
