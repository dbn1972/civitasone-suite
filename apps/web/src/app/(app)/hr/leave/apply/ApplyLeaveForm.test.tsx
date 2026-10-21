import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("@/lib/sync/requestQueue", () => ({ fetchOrQueue: vi.fn() }));
vi.mock("@/lib/activation", () => ({ trackActivation: vi.fn() }));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: toastSuccess, error: toastError, info: vi.fn() } }),
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

const EL_CONTEXT = {
  employee: {}, leaveTypes: [{ id: "lt1", code: "EL", name: "Earned Leave", maxDays: 30 }],
  allocations: [{ id: "a1", leaveTypeId: "lt1", leaveTypeCode: "EL", leaveTypeName: "Earned Leave", balanceDays: 10 }],
};

// GAP-HR-LEAVE-APPLY-01: ApplyLeaveForm also calls POST .../leave-requests/
// preview once the employee, allocId and dates are all set. Routes by URL so
// that call never gets the leave-context response shape (no computedDays
// field) by coincidence — every describe block below that stubs global fetch
// uses this.
function stubContextAndPreview(opts: {
  context?: unknown;
  preview?: unknown | (() => Response);
  /** Rows the employee picker's server-side search (GET /hrms/employees?q=) returns. */
  employeeSearch?: Array<{ id: string; name: string; employeeNo?: string; department?: string }>;
} = {}) {
  const context = opts.context ?? { employee: {}, leaveTypes: [], allocations: [] };
  const fetchMock = vi.fn(async (url: string) => {
    if (typeof url === "string" && url.includes("/leave-requests/preview")) {
      if (typeof opts.preview === "function") return (opts.preview as () => Response)();
      return { ok: true, json: async () => (opts.preview ?? { computedDays: 0, engineApplied: false }) } as Response;
    }
    if (typeof url === "string" && url.includes("/hrms/employees")) {
      return { ok: true, json: async () => ({ data: opts.employeeSearch ?? [] }) } as Response;
    }
    return { ok: true, json: async () => context } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function callsTo(fetchMock: ReturnType<typeof vi.fn>, fragment: string): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes(fragment));
}

/** Waits for the (real, 400ms-debounced) preview fetch to have actually fired. */
async function waitForPreviewFetch(fetchMock: ReturnType<typeof vi.fn>) {
  await waitFor(
    () => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/leave-requests/preview"), expect.anything()),
    { timeout: 2000 },
  );
}

/**
 * GAP-HR-LEAVE-APPLY-03: HR / managers pick WHO the leave is for with a
 * searchable picker that starts EMPTY; a plain employee gets their own single
 * row. The old form defaulted to "myself if in the list, else employees[0]" —
 * an arbitrary person in a field whose only other guard was the leave-type
 * select.
 */
describe("ApplyLeaveForm — employee selection (GAP-HR-LEAVE-APPLY-03)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("HR without ?empId=: the picker shows its placeholder, nobody is selected, no leave-context is requested, Submit is blocked", async () => {
    const fetchMock = stubContextAndPreview();
    renderForm({ employees: EMPLOYEES, canPickEmployee: true });

    const picker = screen.getByRole("combobox", { name: /employee/i });
    expect(picker).toHaveValue("");
    expect(picker).toHaveAttribute("placeholder", expect.stringMatching(/select an employee/i));
    expect(screen.getByRole("button", { name: /submit leave request/i })).toBeDisabled();
    // the leave-type select explains what it is waiting for
    expect(screen.getByRole("option", { name: /select an employee first/i })).toBeInTheDocument();
    // give any (wrongly) eager context fetch a chance to fire
    await new Promise((r) => setTimeout(r, 50));
    expect(callsTo(fetchMock, "/leave-context")).toHaveLength(0);
  });

  it("?empId= preselects exactly that employee (label shown, leave-context requested for them)", async () => {
    const fetchMock = stubContextAndPreview();
    renderForm({ employees: EMPLOYEES, initialEmployeeId: "emp-2", canPickEmployee: true });

    expect(screen.getByRole("combobox", { name: /employee/i })).toHaveValue("Rahul Singh");
    await waitFor(() => expect(callsTo(fetchMock, "/leave-context")[0]).toContain("employeeId=emp-2"));
  });

  it("choosing an employee in the picker loads their leave context and shows the 'applying on behalf of' note", async () => {
    const fetchMock = stubContextAndPreview({
      employeeSearch: [{ id: "emp-9", name: "Meera Iyer", employeeNo: "E009", department: "Legal" }],
    });
    renderForm({ employees: EMPLOYEES, myEmployeeId: "emp-1", canPickEmployee: true });

    fireEvent.change(screen.getByRole("combobox", { name: /employee/i }), { target: { value: "Meera" } });
    // EntityPicker commits a choice on mousedown (so the input's blur cannot close the list first).
    fireEvent.mouseDown(await screen.findByRole("option", { name: /meera iyer/i }, { timeout: 2000 }));

    await waitFor(() => expect(callsTo(fetchMock, "/leave-context")[0]).toContain("employeeId=emp-9"));
    expect(screen.getByText(/applying on behalf of meera iyer/i)).toBeInTheDocument();
  });

  it("a manager (own row injected by the page) gets 'Apply for myself', and can then file their own leave", async () => {
    const fetchMock = stubContextAndPreview({
      context: EL_CONTEXT,
      preview: { computedDays: 2, engineApplied: true, valid: true, warnings: [], balance: 10, balanceAfter: 8 },
    });
    vi.mocked(fetchOrQueue).mockResolvedValue({ response: new Response("{}", { status: 202 }), queued: false, idempotencyKey: "k" });
    const mgr = { id: "emp-mgr", name: "Priya Nair", department: "" };
    renderForm({ employees: [mgr, ...(EMPLOYEES as never[])] as never, myEmployeeId: "emp-mgr", canPickEmployee: true });

    expect(screen.getByRole("button", { name: /submit leave request/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /apply for myself/i }));

    await waitFor(() => expect(callsTo(fetchMock, "/leave-context")[0]).toContain("employeeId=emp-mgr"));
    expect(screen.getByRole("combobox", { name: /employee/i })).toHaveValue("Priya Nair");
    // it IS the signed-in user, so no "on behalf of" note and no second self shortcut
    expect(screen.queryByText(/applying on behalf of/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply for myself/i })).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/leave type/i), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-09-21" } });
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Attending a family function out of town." } });
    await waitForPreviewFetch(fetchMock);
    await waitFor(() => expect(screen.getByRole("button", { name: /submit leave request/i })).toBeEnabled(), { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: /submit leave request/i }));

    await waitFor(() => expect(fetchOrQueue).toHaveBeenCalled());
    expect(vi.mocked(fetchOrQueue).mock.calls[0]![1]).toMatchObject({ body: { employeeId: "emp-mgr", allocId: "a1" } });
  });

  it("a plain employee (single own row, no picker) has themselves selected and no 'Apply for myself' button", async () => {
    const fetchMock = stubContextAndPreview();
    renderForm({ employees: [(EMPLOYEES as never[])[0]] as never, myEmployeeId: "emp-1" });

    expect(screen.getByRole("combobox", { name: /employee/i })).toHaveValue("emp-1");
    expect(screen.queryByRole("button", { name: /apply for myself/i })).not.toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, "/leave-context")[0]).toContain("employeeId=emp-1"));
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
    // employee-selection describe block above uses renderForm().
    renderForm({ employees: EMPLOYEES, initialEmployeeId: "emp-1", canPickEmployee: true });
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
 * GAP-HR-LEAVE-APPLY-01/04: the server preview replaces both the naive
 * calendar-day count shown to the user and the native window.confirm()
 * balance-overrun gate.
 */
describe("ApplyLeaveForm — server-confirmed preview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(fetchOrQueue).mockReset();
    toastSuccess.mockReset();
  });

  async function fillDatesAndAlloc() {
    renderForm({ employees: EMPLOYEES, initialEmployeeId: "emp-1", canPickEmployee: true });
    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/leave type/i), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-09-18" } }); // Friday
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-09-21" } }); // Monday — 4 calendar days, engine may compute fewer
  }

  const submitButton = () => screen.getByRole("button", { name: /submit leave request/i });

  it("shows the server-computed day count, the balance it leaves and the engine's notices — not the raw calendar count", async () => {
    const fetchMock = stubContextAndPreview({
      context: EL_CONTEXT,
      preview: {
        valid: true, computedDays: 2, engineApplied: true,
        warnings: ["Sandwich rule applied: 2 holiday(s) between leave dates counted as leave"],
        violations: [], holidaysInRange: ["2026-09-19"], balance: 10, balanceAfter: 8,
      },
    });
    await fillDatesAndAlloc();
    await waitForPreviewFetch(fetchMock);

    await waitFor(() => expect(screen.getByText(/this will debit/i)).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText(/this will debit/i).parentElement).toHaveTextContent("2 days");
    expect(screen.getByText(/balance after this request: 8 days/i)).toBeInTheDocument();
    expect(screen.getByText(/sandwich rule applied/i)).toBeInTheDocument();
    // none of the approximate-state copy while the server's number is on screen
    expect(screen.queryByText(/approximate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/duration:/i)).not.toBeInTheDocument();
  });

  it("a leave code outside the CCS engine says the count is as entered (engineApplied=false), not that it was adjusted", async () => {
    const fetchMock = stubContextAndPreview({
      context: EL_CONTEXT,
      preview: { valid: true, computedDays: 4, engineApplied: false, warnings: [], violations: [], balance: 10, balanceAfter: 6 },
    });
    await fillDatesAndAlloc();
    await waitForPreviewFetch(fetchMock);

    expect(await screen.findByText(/counted as entered for this leave type/i, {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("when the server says a rule blocks the request, the reasons show inline AT ONCE and Submit is disabled — no click needed, no ConfirmDialog, nothing sent", async () => {
    const fetchMock = stubContextAndPreview({
      context: EL_CONTEXT,
      preview: {
        valid: false, computedDays: 12, engineApplied: true, warnings: [],
        violations: [{ code: "LEAVE_RULE_VIOLATION", message: "Insufficient balance: requested 12 days (computed) but only 10 days available" }],
        balance: 10, balanceAfter: -2,
      },
    });
    await fillDatesAndAlloc();
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Family function out of town this week." } });
    await waitForPreviewFetch(fetchMock);

    const alert = await screen.findByRole("alert", {}, { timeout: 2000 });
    expect(alert).toHaveTextContent(/this request can't be submitted yet/i);
    expect(alert).toHaveTextContent(/insufficient balance: requested 12 days/i);
    expect(submitButton()).toBeDisabled();
    // the debit line is NOT shown for a request that cannot be filed
    expect(screen.queryByText(/this will debit/i)).not.toBeInTheDocument();

    // a forced submit (Enter key) is still refused
    fireEvent.submit(submitButton().closest("form")!);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchOrQueue).not.toHaveBeenCalled();
  });

  it("a preview response with no numeric day count is treated as unavailable: the approximate figure shows, never 'debit NaN days'", async () => {
    const fetchMock = stubContextAndPreview({ context: EL_CONTEXT, preview: {} });
    await fillDatesAndAlloc();
    await waitForPreviewFetch(fetchMock);

    expect(await screen.findByText(/^Approximate/, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByText(/this will debit/i)).not.toBeInTheDocument();
    expect(screen.getByText(/duration:/i).parentElement).toHaveTextContent("4 days");
  });

  it("when the preview request itself is refused (e.g. 403), says so inline and keeps Submit disabled", async () => {
    const fetchMock = stubContextAndPreview({
      context: EL_CONTEXT,
      preview: () => new Response(JSON.stringify({ code: "FORBIDDEN", message: "internal: employees may only apply for their own record" }), { status: 403 }),
    });
    await fillDatesAndAlloc();
    await waitForPreviewFetch(fetchMock);

    const alert = await screen.findByRole("alert", {}, { timeout: 2000 });
    expect(alert).toHaveTextContent(/this request can't be submitted yet/i);
    expect(alert.textContent).not.toMatch(/internal:/); // clerk-safe: never the raw server text
    expect(submitButton()).toBeDisabled();
  });

  it("after a successful submit the confirmation names the server-confirmed days and leave type", async () => {
    const fetchMock = stubContextAndPreview({
      context: EL_CONTEXT,
      preview: { valid: true, computedDays: 2, engineApplied: true, warnings: [], violations: [], balance: 10, balanceAfter: 8 },
    });
    vi.mocked(fetchOrQueue).mockResolvedValue({ response: new Response("{}", { status: 202 }), queued: false, idempotencyKey: "k" });
    await fillDatesAndAlloc();
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Family function out of town this week." } });
    await waitForPreviewFetch(fetchMock);
    await waitFor(() => expect(submitButton()).toBeEnabled(), { timeout: 2000 });
    fireEvent.click(submitButton());

    expect(await screen.findByText("Leave request submitted for approval: 2 days of Earned Leave.", {}, { timeout: 2000 })).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith("Leave request submitted for approval: 2 days of Earned Leave.");
    // and the number sent is the server's, not the 4-day calendar span
    expect(vi.mocked(fetchOrQueue).mock.calls[0]![1]).toMatchObject({ body: { daysApplied: 2 } });
  });
});

/**
 * GAP-HR-LEAVE-APPLY-01/04: when the preview cannot be reached (offline) the
 * form falls back to the calendar-day figure — honestly labelled approximate —
 * and, only if that exceeds the visible balance, asks via the styled
 * ConfirmDialog (never window.confirm). The queued/offline submit path stays.
 */
describe("ApplyLeaveForm — offline fallback (preview unreachable)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(fetchOrQueue).mockReset();
  });

  function stubOffline() {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/leave-requests/preview")) throw new TypeError("Failed to fetch");
      if (url.includes("/hrms/employees")) return { ok: true, json: async () => ({ data: [] }) } as Response;
      return { ok: true, json: async () => EL_CONTEXT } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function fill(from: string, to: string) {
    renderForm({ employees: EMPLOYEES, initialEmployeeId: "emp-1", canPickEmployee: true });
    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/leave type/i), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: from } });
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: to } });
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Family function out of town this week." } });
  }

  it("shows the calendar count as approximate, with copy that no longer claims weekends/holidays are excluded", async () => {
    const fetchMock = stubOffline();
    await fill("2026-09-18", "2026-09-21");
    await waitForPreviewFetch(fetchMock);

    const note = await screen.findByText(/^Approximate/, {}, { timeout: 2000 });
    expect(note.textContent).not.toMatch(/excludes weekends/i);
    expect(note.textContent).toMatch(/calendar days/i);
    expect(screen.getByText(/duration:/i).parentElement).toHaveTextContent("4 days");
  });

  it("over the visible balance it asks in the styled dialog (not window.confirm); confirming submits the approximate count through the offline queue", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const fetchMock = stubOffline();
    vi.mocked(fetchOrQueue).mockResolvedValue({ response: null, queued: true, idempotencyKey: "kq" });
    await fill("2026-09-01", "2026-09-14"); // 14 calendar days > balance 10
    await waitForPreviewFetch(fetchMock);
    await waitFor(() => expect(screen.getByRole("button", { name: /submit leave request/i })).toBeEnabled(), { timeout: 2000 });

    fireEvent.click(screen.getByRole("button", { name: /submit leave request/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/you are applying for 14 days but only have 10 days balance/i);
    expect(fetchOrQueue).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /submit anyway/i }));
    await waitFor(() => expect(fetchOrQueue).toHaveBeenCalled());
    expect(vi.mocked(fetchOrQueue).mock.calls[0]![1]).toMatchObject({ body: { daysApplied: 14 } });
    expect(await screen.findByText(/saved and will submit automatically/i)).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("within the visible balance it queues straight away with no dialog", async () => {
    const fetchMock = stubOffline();
    vi.mocked(fetchOrQueue).mockResolvedValue({ response: null, queued: true, idempotencyKey: "kq2" });
    await fill("2026-09-18", "2026-09-21");
    await waitForPreviewFetch(fetchMock);
    await waitFor(() => expect(screen.getByRole("button", { name: /submit leave request/i })).toBeEnabled(), { timeout: 2000 });

    fireEvent.click(screen.getByRole("button", { name: /submit leave request/i }));
    await waitFor(() => expect(fetchOrQueue).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
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
    renderForm({ employees: EMPLOYEES, initialEmployeeId: "emp-1", canPickEmployee: true });
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
