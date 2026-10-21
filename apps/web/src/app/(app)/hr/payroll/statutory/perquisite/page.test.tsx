import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// GAP-PAYROLL-STATUTORY-PERQUISITE-02/04: page now has a role gate (this
// page previously rendered -- including another employee's PAN -- for any
// /hr role at all) -- default to an authorized role so the existing content
// tests below keep exercising the real page body; the dedicated gate test
// overrides this per-call.
const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn(() => ["payroll_admin"]) }));
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

import PerquisitePage from "./page";

// UX-017: PerquisitePage (Server Component, getTranslations("perquisite"))
// also renders EmployeeFyLookup and PerquisiteComponentForm, both "use
// client" components that call useTranslations -- so every render needs a
// real NextIntlClientProvider in the tree, same pattern as
// hr/payroll/disbursement/page.test.tsx (tranche 9).
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PerquisitePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("denies a role with no payroll/HR privilege before fetching anything", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    const ui = await PerquisitePage({ searchParams: { employeeId: "e1", fy: "2026-27" } });
    renderPage(ui);
    expect(screen.getByText(/don.t have permission/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("prompts for employee and FY when none is selected", async () => {
    const ui = await PerquisitePage({ searchParams: {} });
    renderPage(ui);
    expect(screen.getByText("Select an employee and financial year")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders the Form 12BA statement when found, with the PAN masked", async () => {
    fetchJsonMock.mockResolvedValue({
      data: {
        formType: "12BA", fy: "2026-27", assessmentYear: "2027-28",
        employer: { name: "Govt", tan: "T1", pan: "P1" },
        employee: { employeeId: "e1", pan: "ABCDE1234F", name: "Test Employee", panFlag: "" },
        perquisites: [{ sl: 1, nature: "car", description: "", valueByEmployerMinor: 60000, amountRecoveredMinor: 10000, taxableValueMinor: 50000, value: 500 }],
        totalPerquisitesMinor: 50000, totalPerquisites: 500, note: "ok",
      },
      source: "api",
    });
    const ui = await PerquisitePage({ searchParams: { employeeId: "e1", fy: "2026-27" } });
    renderPage(ui);
    // The name is shown in the Form 12BA card and (GAP-PAYROLL-STATUTORY-PERQUISITE-05) in the add-component form.
    expect(screen.getAllByText("Test Employee")).toHaveLength(2);
    // GAP-PAYROLL-STATUTORY-PERQUISITE-04: the full PAN must never appear.
    expect(screen.queryByText("ABCDE1234F")).not.toBeInTheDocument();
    expect(screen.getByText("ABCDE****F")).toBeInTheDocument();
    // GAP-PAYROLL-STATUTORY-PERQUISITE-06: employer/AY header now shown.
    expect(screen.getByText("Govt")).toBeInTheDocument();
    expect(screen.getByText("2027-28")).toBeInTheDocument();
  });

  it("renders an empty state on a genuine 404 (no perquisites on file)", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "api", status: 404 });
    const ui = await PerquisitePage({ searchParams: { employeeId: "e1", fy: "2026-27" } });
    renderPage(ui);
    expect(screen.getByText("No Form 12BA data")).toBeInTheDocument();
  });

  // GAP-PAYROLL-STATUTORY-PERQUISITE-01: a failed lookup (source:"error")
  // used to render the exact same "No Form 12BA data" EmptyState as a
  // genuine empty result -- an outage read as "this employee has no
  // perquisites". Any error status other than 404 must show the real error
  // affordance with a retry, not the empty-state copy.
  it("renders the error affordance (not the empty-state copy) when the lookup fails", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    const ui = await PerquisitePage({ searchParams: { employeeId: "e1", fy: "2026-27" } });
    renderPage(ui);
    expect(screen.queryByText("No Form 12BA data")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
  });
});

// ── GAP-PAYROLL-STATUTORY-PERQUISITE-04 / -05 (cluster 04) ───────────────────
const EMP_ID = "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0";
function form12ba(over: Record<string, unknown> = {}) {
  return {
    formType: "12BA", fy: "2026-27", assessmentYear: "2027-28",
    employer: { name: "Govt", tan: "T1", pan: "P1" },
    employee: { employeeId: EMP_ID, pan: "ABCDE****F", name: "Ravi Kumar", panFlag: "" },
    perquisites: [{ sl: 1, nature: "car", description: "", valueByEmployerMinor: 60000, amountRecoveredMinor: 10000, taxableValueMinor: 50000, value: 500 }],
    totalPerquisitesMinor: 50000, totalPerquisites: 500, note: "ok",
    ...over,
  };
}
const revealButtons = () => screen.queryAllByRole("button", { name: "Reveal" });

describe("PerquisitePage PAN: masked, audited reveal only for the roles that may (GAP-PAYROLL-STATUTORY-PERQUISITE-04)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    vi.restoreAllMocks();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("a payroll role sees the PAN masked with NO reveal control (it cannot reveal at the source)", async () => {
    fetchJsonMock.mockResolvedValue({ data: form12ba(), source: "api" });
    renderPage(await PerquisitePage({ searchParams: { employeeId: EMP_ID, fy: "2026-27" } }));
    expect(screen.getByText("ABCDE****F")).toBeInTheDocument();
    expect(revealButtons()).toHaveLength(0);
  });

  it("even if the API ever returned a clear PAN, the page never puts it in the DOM", async () => {
    fetchJsonMock.mockResolvedValue({ data: form12ba({ employee: { employeeId: EMP_ID, pan: "ABCDE1234F", name: "Ravi Kumar", panFlag: "" } }), source: "api" });
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {await PerquisitePage({ searchParams: { employeeId: EMP_ID, fy: "2026-27" } })}
      </NextIntlClientProvider>,
    );
    expect(container.innerHTML).not.toContain("ABCDE1234F");
    expect(screen.getByText("ABCDE****F")).toBeInTheDocument();
  });

  it("hr_admin gets a Reveal control; confirming asks for a reason and calls the audited hrms endpoint once, then shows the value", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({ data: form12ba(), source: "api" });
    // The employee picker resolves its seeded id through the directory; only the reveal call is under test.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).includes("pii/reveal")
        ? new Response(JSON.stringify({ data: { value: "ABCDE1234F" } }), { status: 200 })
        : new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const revealCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("pii/reveal"));
    renderPage(await PerquisitePage({ searchParams: { employeeId: EMP_ID, fy: "2026-27" } }));
    expect(revealButtons()).toHaveLength(1);
    expect(revealCalls()).toHaveLength(0); // nothing is revealed until a reason is confirmed

    fireEvent.click(revealButtons()[0]!);
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "verify PAN for Form 12BA" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" }).pop()!);

    expect(await screen.findByText("ABCDE1234F")).toBeInTheDocument();
    expect(revealCalls()).toHaveLength(1);
    const [url, init] = revealCalls()[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/hrms/pii/reveal");
    expect(JSON.parse(init.body as string)).toEqual({
      resourceType: "employee", resourceId: EMP_ID, field: "pan", reason: "verify PAN for Form 12BA",
    });
  });

  it("a refused reveal (403) keeps the PAN masked", async () => {
    getSessionRolesMock.mockReturnValue(["super_admin"]);
    fetchJsonMock.mockResolvedValue({ data: form12ba(), source: "api" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }));
    renderPage(await PerquisitePage({ searchParams: { employeeId: EMP_ID, fy: "2026-27" } }));
    fireEvent.click(revealButtons()[0]!);
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "verify PAN for Form 12BA" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" }).pop()!);
    expect(await screen.findByText(enMessages.piiReveal.forbidden)).toBeInTheDocument();
    expect(screen.getByText("ABCDE****F")).toBeInTheDocument();
  });

  it("an employee without a PAN shows the PANNOTAVBL flag and no reveal control", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({ data: form12ba({ employee: { employeeId: EMP_ID, pan: "", name: "Ravi Kumar", panFlag: "PANNOTAVBL" } }), source: "api" });
    renderPage(await PerquisitePage({ searchParams: { employeeId: EMP_ID, fy: "2026-27" } }));
    expect(screen.getByText("PANNOTAVBL")).toBeInTheDocument();
    expect(revealButtons()).toHaveLength(0);
  });
});

describe("PerquisitePage employee name and FY validation (GAP-PAYROLL-STATUTORY-PERQUISITE-05)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("the page header names the employee and FY; the add-component form shows the name, never the UUID", async () => {
    fetchJsonMock.mockResolvedValue({ data: form12ba(), source: "api" });
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {await PerquisitePage({ searchParams: { employeeId: EMP_ID, fy: "2026-27" } })}
      </NextIntlClientProvider>,
    );
    expect(document.querySelector(".ph .sub")).toHaveTextContent("Perquisites and Form 12BA for Ravi Kumar, FY 2026-27.");
    // Form 12BA card + add-component form (the header carries the name inside its sentence, checked above).
    expect(screen.getAllByText("Ravi Kumar")).toHaveLength(2);
    expect(container.textContent).not.toContain(EMP_ID);
  });

  it("without a successful lookup the header keeps the generic subtitle", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "api", status: 404 });
    renderPage(await PerquisitePage({ searchParams: { employeeId: EMP_ID, fy: "2026-27" } }));
    expect(document.querySelector(".ph .sub")).toHaveTextContent("Itemised perquisite components (Sec 17(2)) and the statutory Form 12BA statement.");
  });

  it.each(["2026", "2026-28", "26-27", "2026-2027"])("a hand-edited FY %s is refused with a message and nothing is fetched", async (badFy) => {
    renderPage(await PerquisitePage({ searchParams: { employeeId: EMP_ID, fy: badFy } }));
    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("The financial year in the address is not valid");
    // and the add-component form stays locked behind a fresh lookup
    expect(screen.getByText("Look up an employee first")).toBeInTheDocument();
  });
});

// Review (cluster 04): Form 12BA takes the name from the FY's last payroll month, so a blank name
// is real for an employee who is not in that month. The page resolves it from the HRMS directory by id.
describe("PerquisitePage employee name when the Form 12BA response has none (GAP-PAYROLL-STATUTORY-PERQUISITE-05)", () => {
  type FetchOpts = { mapResponse: (p: unknown) => unknown };
  const blankNameBody = () =>
    form12ba({ employee: { employeeId: EMP_ID, pan: "ABCDE****F", name: "", panFlag: "" } });
  const isDirectory = (path: unknown) => String(path).includes("/api/v1/hrms/employees");
  const directoryCalls = () => fetchJsonMock.mock.calls.filter((c) => isDirectory(c[0]));

  /** form12ba -> blank name; directory -> `directoryRows` run through the page's own mapResponse. */
  function mockLookup(directoryRows: unknown, directoryStatus: "ok" | "error" = "ok") {
    fetchJsonMock.mockImplementation(async (path: unknown, empty: unknown, opts: FetchOpts) => {
      if (isDirectory(path)) {
        return directoryStatus === "ok"
          ? { data: opts.mapResponse(directoryRows), source: "api" }
          : { data: empty, source: "error", status: 403 };
      }
      return { data: blankNameBody(), source: "api" };
    });
  }

  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("names the employee from the directory in the header, the Form 12BA card and the add-component form (never the UUID)", async () => {
    mockLookup({ data: [{ id: EMP_ID, name: "Ravi Kumar", employeeNo: "EMP-7", department: "Finance" }] });
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {await PerquisitePage({ searchParams: { employeeId: EMP_ID, fy: "2026-27" } })}
      </NextIntlClientProvider>,
    );
    expect(document.querySelector(".ph .sub")).toHaveTextContent("Perquisites and Form 12BA for Ravi Kumar (EMP-7), FY 2026-27.");
    expect(screen.getAllByText("Ravi Kumar (EMP-7)")).toHaveLength(2); // 12BA card + add-component form
    expect(screen.queryByText("Selected employee")).not.toBeInTheDocument();
    expect(screen.queryByText("Unknown employee")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain(EMP_ID);
    // one directory read, by the id from the address, nothing else
    expect(directoryCalls()).toHaveLength(1);
    expect(directoryCalls()[0]![0]).toBe(`/api/v1/hrms/employees?ids=${EMP_ID}`);
  });

  it("ignores a directory row for any other id (the label can only be the looked-up employee's)", async () => {
    mockLookup({ data: [{ id: "00000000-0000-4000-8000-000000000001", name: "Someone Else", employeeNo: "EMP-9" }] });
    renderPage(await PerquisitePage({ searchParams: { employeeId: EMP_ID, fy: "2026-27" } }));
    expect(screen.queryByText(/Someone Else/)).not.toBeInTheDocument();
    expect(screen.getByText("Selected employee")).toBeInTheDocument();
  });

  it("without directory access (or an outage) the page still renders with the generic wording and no UUID", async () => {
    mockLookup(null, "error");
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {await PerquisitePage({ searchParams: { employeeId: EMP_ID, fy: "2026-27" } })}
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Selected employee")).toBeInTheDocument();
    expect(screen.getByText("Unknown employee")).toBeInTheDocument();
    expect(document.querySelector(".ph .sub")).toHaveTextContent("Itemised perquisite components");
    expect(container.textContent).not.toContain(EMP_ID);
  });

  it("does not read the directory when the Form 12BA response already carries the name, or when there is no lookup", async () => {
    fetchJsonMock.mockResolvedValue({ data: form12ba(), source: "api" });
    renderPage(await PerquisitePage({ searchParams: { employeeId: EMP_ID, fy: "2026-27" } }));
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);

    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ data: null, source: "api", status: 404 });
    renderPage(await PerquisitePage({ searchParams: { employeeId: EMP_ID, fy: "2026-27" } }));
    expect(directoryCalls()).toHaveLength(0);
  });
});
