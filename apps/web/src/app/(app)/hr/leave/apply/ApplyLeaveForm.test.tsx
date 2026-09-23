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

describe("ApplyLeaveForm — deep-link preselection", () => {
  // The component's own useEffect fetches leave-context for the selected
  // employee on mount; stub it so that's deterministic and quiet.
  afterEach(() => vi.unstubAllGlobals());
  function stubLeaveContextFetch() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ employee: {}, leaveTypes: [], allocations: [] }) }) as Response),
    );
  }

  it("defaults to the first employee when no initialEmployeeId is given", () => {
    stubLeaveContextFetch();
    renderForm({ employees: EMPLOYEES });
    expect(screen.getByRole("combobox", { name: /employee/i })).toHaveValue("emp-1");
  });

  it("preselects the employee named by ?empId= (via initialEmployeeId), not just the first in the list", () => {
    stubLeaveContextFetch();
    renderForm({ employees: EMPLOYEES, initialEmployeeId: "emp-2" });
    expect(screen.getByRole("combobox", { name: /employee/i })).toHaveValue("emp-2");
  });

  it("falls back to the first employee if initialEmployeeId isn't in the list", () => {
    stubLeaveContextFetch();
    renderForm({ employees: EMPLOYEES, initialEmployeeId: "does-not-exist" });
    expect(screen.getByRole("combobox", { name: /employee/i })).toHaveValue("emp-1");
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({
          ok: true,
          json: async () => ({
            employee: { id: "emp-1", employeeNo: "E1", name: "Asha Verma" },
            leaveTypes: [{ id: "lt1", code: "EL", name: "Earned Leave", maxDays: 30 }],
            allocations: [{ id: "a1", leaveTypeId: "lt1", leaveTypeCode: "EL", leaveTypeName: "Earned Leave", balanceDays: 10 }],
          }),
        }) as Response,
      ),
    );
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
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/leave-service/);
    expect(alert.textContent).not.toMatch(/\b409\b/);
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/couldn't save/i));
  });

  it("shows a clerk-safe message when there is no response at all (network failure, not queued)", async () => {
    vi.mocked(fetchOrQueue).mockResolvedValue({ response: null, queued: false, idempotencyKey: "k2" });
    await fillAndSubmit();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
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
