import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("@/lib/sync/requestQueue", () => ({ fetchOrQueue: vi.fn() }));
vi.mock("@/lib/activation", () => ({ trackActivation: vi.fn() }));
const toastError = vi.fn();
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: toastError, info: vi.fn() } }),
}));

import { ApplyLeaveForm } from "./ApplyLeaveForm";
import { fetchOrQueue } from "@/lib/sync/requestQueue";

const EMPLOYEES = [
  { id: "emp-1", name: "Asha Verma", department: "Finance" },
  { id: "emp-2", name: "Rahul Singh", department: "IT" },
] as never;

// UX-017 (tranche 2): ApplyLeaveForm now reads its copy through next-intl
// (useTranslations("leaveApply")), so it needs a real provider in the tree —
// same pattern as citizen/grievances/GrievancesTable.test.tsx.
function renderForm(props: Parameters<typeof ApplyLeaveForm>[0]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ApplyLeaveForm {...props} />
    </NextIntlClientProvider>,
  );
}

// GAP-HR-LEAVE-APPLY-01: ApplyLeaveForm now ALSO calls POST .../leave-requests/
// preview once allocId/fromDate/toDate are all set. Routes by URL so that call
// never gets the leave-context response shape (no computedDays field) by
// coincidence — every describe block below that stubs global fetch uses this.
function stubContextAndPreview(opts: {
  context?: unknown;
  preview?: unknown | (() => Response);
} = {}) {
  const context = opts.context ?? { employee: {}, leaveTypes: [], allocations: [] };
  const fetchMock = vi.fn(async (url: string) => {
    if (typeof url === "string" && url.includes("/leave-requests/preview")) {
      if (typeof opts.preview === "function") return (opts.preview as () => Response)();
      return { ok: true, json: async () => (opts.preview ?? { computedDays: 0, engineApplied: false }) } as Response;
    }
    return { ok: true, json: async () => context } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Waits for the (real, 400ms-debounced) preview fetch to have actually fired. */
async function waitForPreviewFetch(fetchMock: ReturnType<typeof vi.fn>) {
  await waitFor(
    () => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/leave-requests/preview"), expect.anything()),
    { timeout: 2000 },
  );
}

describe("ApplyLeaveForm — deep-link preselection", () => {
  // The component's own useEffect fetches leave-context for the selected
  // employee on mount; stub it so that's deterministic and quiet.
  afterEach(() => vi.unstubAllGlobals());
  function stubLeaveContextFetch() {
    stubContextAndPreview();
  }

  // GAP-HR-LEAVE-ALLOCATE-04: with several employees to pick from (HR / manager)
  // the control is a type-ahead picker; the selected person shows as its text.
  it("defaults to the first employee when no initialEmployeeId is given", () => {
    stubLeaveContextFetch();
    renderForm({ employees: EMPLOYEES });
    expect(screen.getByRole("combobox", { name: /employee/i })).toHaveValue("Asha Verma");
  });

  it("preselects the employee named by ?empId= (via initialEmployeeId), not just the first in the list", () => {
    stubLeaveContextFetch();
    renderForm({ employees: EMPLOYEES, initialEmployeeId: "emp-2" });
    expect(screen.getByRole("combobox", { name: /employee/i })).toHaveValue("Rahul Singh");
  });

  it("falls back to the first employee if initialEmployeeId isn't in the list and the directory does not know it either", async () => {
    stubLeaveContextFetch();
    renderForm({ employees: EMPLOYEES, initialEmployeeId: "does-not-exist" });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/hrms/employees?ids=does-not-exist")));
    expect(screen.getByRole("combobox", { name: /employee/i })).toHaveValue("Asha Verma");
  });
});

/**
 * GAP-HR-LEAVE-ALLOCATE-04: the HR/manager employee control used to be a plain
 * <select> over getEmployees()' default page (50, arbitrary order) -- anyone
 * further down a larger tenant could not be chosen, and there was no search.
 */
describe("ApplyLeaveForm — employee picker searches the directory (GAP-HR-LEAVE-ALLOCATE-04)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubDirectory() {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/hrms/employees?q=")) {
        return { ok: true, status: 200, json: async () => ({ data: [{ id: "emp-9042", employeeNo: "E9042", name: "Zubin Khan", department: "Audit", designation: "Auditor" }] }) } as Response;
      }
      if (url.includes("/hrms/employees?ids=")) {
        const ids = new URL(`http://x${url}`).searchParams.get("ids");
        return { ok: true, status: 200, json: async () => ({ data: ids === "emp-9042" ? [{ id: "emp-9042", employeeNo: "E9042", name: "Zubin Khan", department: "Audit" }] : [] }) } as Response;
      }
      if (url.includes("/leave-requests/preview")) return { ok: true, json: async () => ({ computedDays: 0, engineApplied: false }) } as Response;
      return { ok: true, json: async () => ({ employee: {}, leaveTypes: [], allocations: [] }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("finds an employee who is not in the server-sent page by typing, and loads THEIR leave context", async () => {
    const fetchMock = stubDirectory();
    renderForm({ employees: EMPLOYEES });

    const picker = screen.getByRole("combobox", { name: /employee/i });
    fireEvent.change(picker, { target: { value: "zubin" } });
    fireEvent.mouseDown(await screen.findByText("Zubin Khan (E9042)"));

    await waitFor(() => expect(picker).toHaveValue("Zubin Khan (E9042)"));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
      expect(urls.some((u) => u.includes("/leave-context?employeeId=emp-9042"))).toBe(true);
    });
    // ...and the "on behalf of" note names them, though they were never in `employees`.
    expect(await screen.findByText("Applying on behalf of Zubin Khan (E9042).")).toBeInTheDocument();
  });

  it("honours an ?empId= deep link to someone beyond the server page, once the directory confirms them", async () => {
    stubDirectory();
    renderForm({ employees: EMPLOYEES, initialEmployeeId: "emp-9042" });
    await waitFor(() => expect(screen.getByRole("combobox", { name: /employee/i })).toHaveValue("Zubin Khan (E9042)"));
  });

  it("offers 'Apply for myself' when the viewer's own record is known and someone else is selected", async () => {
    stubDirectory();
    renderForm({ employees: EMPLOYEES, myEmployeeId: "emp-1", initialEmployeeId: "emp-2" });
    fireEvent.click(await screen.findByRole("button", { name: /apply for myself/i }));
    expect(screen.getByRole("combobox", { name: /employee/i })).toHaveValue("Asha Verma");
    expect(screen.queryByRole("button", { name: /apply for myself/i })).not.toBeInTheDocument();
  });

  it("keeps the plain select for the single-row self-service case (nobody else to find)", () => {
    stubDirectory();
    renderForm({ employees: [EMPLOYEES[0]] as never, myEmployeeId: "emp-1" });
    expect(screen.getByRole("combobox", { name: /employee/i }).tagName).toBe("SELECT");
  });
});

/**
 * UX-016: a failed submit used to show the raw response text (falling back
 * to `Request failed (${response?.status ?? "network"})`) verbatim, both
 * inline and in the toast — the same class of leak useFormError closes
 * fleet-wide (UX-003).
 */
describe("ApplyLeaveForm — UX-016 clerk-safe errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(fetchOrQueue).mockReset();
    toastError.mockReset();
  });

  function stubLeaveContextFetchWithAllocation() {
    stubContextAndPreview({
      context: {
        employee: { id: "emp-1", employeeNo: "E1", name: "Asha Verma" },
        leaveTypes: [{ id: "lt1", code: "EL", name: "Earned Leave", maxDays: 30 }],
        allocations: [{ id: "a1", leaveTypeId: "lt1", leaveTypeCode: "EL", leaveTypeName: "Earned Leave", balanceDays: 10 }],
      },
      preview: { computedDays: 2, engineApplied: true },
    });
  }

  async function fillAndSubmit() {
    stubLeaveContextFetchWithAllocation();
    // Plain render() would throw here: ApplyLeaveForm calls useTranslations()
    // (UX-017) and needs a NextIntlClientProvider ancestor — same reason the
    // deep-link-preselection describe block above uses renderForm().
    renderForm({ employees: EMPLOYEES });
    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/leave type/i), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-09-21" } });
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Attending a family function out of town." },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit leave request/i }));
  }

  it("shows a clerk-safe message, never the raw response text or status, when the request is rejected (not queued)", async () => {
    vi.mocked(fetchOrQueue).mockResolvedValue({
      response: new Response("leave-service: overlapping request rejected", { status: 409 }),
      queued: false,
      idempotencyKey: "k1",
    });
    await fillAndSubmit();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/This leave request was changed by someone else\. Refresh to see the latest version, then try again\./));
    expect(alert.textContent).not.toMatch(/leave-service/);
    expect(alert.textContent).not.toMatch(/\b409\b/);
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/This leave request was changed by someone else\. Refresh to see the latest version, then try again\./));
  });

  it("shows a clerk-safe message when there is no response at all (network failure, not queued)", async () => {
    vi.mocked(fetchOrQueue).mockResolvedValue({ response: null, queued: false, idempotencyKey: "k2" });
    await fillAndSubmit();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/We couldn't connect\. Check your internet connection and try again\./));
    expect(alert.textContent).not.toMatch(/\bnetwork\b/);
  });
});

/**
 * Self-service leave-application fix: an employee with no linked employee
 * record (noLinkedProfile, resolved by page.tsx from a genuine 404 on
 * GET /v1/hrms/me/profile — see page.test.tsx for the full role-resolution
 * coverage) must see a clear, honest message, never the bare, confusing
 * "No employees loaded" dropdown with an unexplained disabled submit button.
 */
/**
 * GAP-HR-LEAVE-APPLY-01/04: server preview replaces both the naive
 * calendar-day count shown to the user and the native window.confirm()
 * balance-overrun gate.
 */
describe("ApplyLeaveForm — server-confirmed preview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(fetchOrQueue).mockReset();
  });

  async function fillDatesAndAlloc() {
    renderForm({ employees: EMPLOYEES });
    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/leave type/i), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-09-18" } }); // Friday
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-09-21" } }); // Monday — 4 calendar days, engine may compute fewer
  }

  it("shows the server-computed day count once preview resolves, not the raw calendar count", async () => {
    const fetchMock = stubContextAndPreview({
      context: {
        employee: {}, leaveTypes: [{ id: "lt1", code: "EL", name: "Earned Leave", maxDays: 30 }],
        allocations: [{ id: "a1", leaveTypeId: "lt1", leaveTypeCode: "EL", leaveTypeName: "Earned Leave", balanceDays: 10 }],
      },
      preview: { computedDays: 2, engineApplied: true }, // engine excluded the weekend
    });
    await fillDatesAndAlloc();
    await waitForPreviewFetch(fetchMock);

    await waitFor(() => expect(screen.getByText(/this will debit/i)).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText(/this will debit/i).parentElement).toHaveTextContent("2 days");
    expect(screen.queryByText(/approximate/i)).not.toBeInTheDocument();
  });

  it("blocks submit inline (no native confirm, no ConfirmDialog) when preview itself reports a rule violation", async () => {
    const fetchMock = stubContextAndPreview({
      context: {
        employee: {}, leaveTypes: [{ id: "lt1", code: "EL", name: "Earned Leave", maxDays: 30 }],
        allocations: [{ id: "a1", leaveTypeId: "lt1", leaveTypeCode: "EL", leaveTypeName: "Earned Leave", balanceDays: 1 }],
      },
      preview: () => new Response(JSON.stringify({ code: "LEAVE_RULE_VIOLATION", message: "insufficient balance" }), { status: 422 }),
    });
    await fillDatesAndAlloc();
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Family function out of town this week." } });
    await waitForPreviewFetch(fetchMock);
    // Let the rejected preview's .then() (setPreviewError) actually commit
    // before clicking — waitForPreviewFetch only confirms the call fired.
    await waitFor(() => expect(screen.queryByText(/checking against/i)).not.toBeInTheDocument(), { timeout: 2000 });

    fireEvent.click(screen.getByRole("button", { name: /submit leave request/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent?.trim()).not.toBe(""), { timeout: 2000 });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); // no ConfirmDialog — blocked, not just warned
    expect(fetchOrQueue).not.toHaveBeenCalled();
  });
});

describe("ApplyLeaveForm — no linked employee record (self-service)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the 'contact HR' message and hides the form entirely when noLinkedProfile is true", () => {
    renderForm({ employees: [], noLinkedProfile: true });

    expect(screen.getByText(/no employee record is linked to your account/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit leave request/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/no employees loaded/i)).not.toBeInTheDocument();
  });

  it("still shows the normal (disabled) form for an empty employees list when noLinkedProfile is false — a real failure, not a confirmed absent record", () => {
    renderForm({ employees: [], noLinkedProfile: false });

    expect(screen.queryByText(/no employee record is linked to your account/i)).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /no employees loaded/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit leave request/i })).toBeDisabled();
  });
});

/**
 * GAP-HR-LEAVE-APPLY-05: half-day / short leave behind the per-tenant switch.
 */
describe("ApplyLeaveForm — half-day / short leave (GAP-HR-LEAVE-APPLY-05)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubWithConfig(config: unknown) {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("/leave-config")) return { ok: true, json: async () => config } as Response;
      if (url.includes("/leave-requests/preview")) return { ok: true, json: async () => ({ computedDays: 0.5, engineApplied: true }) } as Response;
      return {
        ok: true,
        json: async () => ({
          employee: { id: "emp-1", employeeNo: "E1", name: "Asha Verma" },
          leaveTypes: [{ id: "lt1", code: "CL", name: "Casual Leave", maxDays: 8 }],
          allocations: [{ id: "a1", leaveTypeId: "lt1", leaveTypeCode: "CL", leaveTypeName: "Casual Leave", balanceDays: 7.5 }],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function pickSingleDateCl() {
    renderForm({ employees: EMPLOYEES });
    await waitFor(() => expect(screen.getByRole("option", { name: /casual leave/i })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/leave type/i), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-10-05" } });
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-10-05" } });
  }

  it("shows NO duration control while the tenant switch is off (default)", async () => {
    stubWithConfig({ halfDayEnabled: false, shortLeaveEnabled: false });
    await pickSingleDateCl();
    await waitFor(() => expect(screen.getByLabelText(/from date/i)).toHaveValue("2026-10-05"));
    expect(screen.queryByLabelText(/duration/i)).toBeNull();
  });

  it("offers the half-day choices when enabled, and previews/sends exactly 0.5 with the chosen part", async () => {
    const fetchMock = stubWithConfig({ halfDayEnabled: true, shortLeaveEnabled: false });
    await pickSingleDateCl();
    const select = await screen.findByLabelText(/duration/i);
    expect(screen.queryByRole("option", { name: /short leave/i })).toBeNull();
    fireEvent.change(select, { target: { value: "first_half" } });
    await waitFor(() => {
      const previewCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/leave-requests/preview"));
      const last = previewCalls[previewCalls.length - 1]!;
      const body = JSON.parse(String(last[1]!.body));
      expect(body).toMatchObject({ dayPart: "first_half", daysApplied: 0.5 });
    }, { timeout: 2500 });
  });

  it("hides the duration control again when the date range is widened", async () => {
    stubWithConfig({ halfDayEnabled: true, shortLeaveEnabled: true });
    await pickSingleDateCl();
    await screen.findByLabelText(/duration/i);
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-10-07" } });
    await waitFor(() => expect(screen.queryByLabelText(/duration/i)).toBeNull());
  });
});
