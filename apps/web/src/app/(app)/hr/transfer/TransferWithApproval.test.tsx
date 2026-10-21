import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// GAP-HR-TRANSFER-10: the transfer UI is translated client-side, so every render needs a provider.
const render = (ui: ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const toastSuccess = vi.fn();
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: toastSuccess, error: vi.fn(), info: vi.fn() } }),
}));

import { TransferWithApproval } from "./TransferWithApproval";

type Dept = { id: string; name: string };
type DirRow = { id: string; employeeNo: string; name: string; department: string };

const DEPARTMENTS: Dept[] = [
  { id: "dept-1", name: "Finance" },
  { id: "dept-2", name: "Works" },
];
// The employee directory (GET /v1/hrms/employees) returns the department NAME only, never its id.
// The same directory backs the employee search, the approving-officer search and the ?ids= resolve.
const DIRECTORY: DirRow[] = [
  { id: "emp-1", employeeNo: "E-001", name: "Asha Verma", department: "Finance" },
  { id: "emp-off-1", employeeNo: "E-010", name: "S. Rao", department: "Finance" },
  { id: "emp-off-2", employeeNo: "E-020", name: "P. Iyer", department: "Works" },
  { id: "emp-nodept", employeeNo: "E-030", name: "Nameless Dept", department: "—" },
  { id: "emp-ghost", employeeNo: "E-031", name: "Ghost Wing", department: "Wing Not In List" },
];
const ME = { id: "me-1", fullName: "Meera Self", employeeNo: "E-009" };
const PAY_STRUCTURES = [
  { id: "ps-1", name: "Pay Level 6 (GP 4200)" },
  { id: "ps-2", name: "Pay Level 7 (GP 4600)" },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

interface Routing {
  submitApproval?: () => Response;
  fromModule?: () => Response;
  departments?: () => Response | Promise<Response>;
  directory?: DirRow[];
  employeeSearch?: (q: string) => Response | null;
}

/**
 * Routes every GET the wizard makes to fixtures and records the two mutating
 * calls (URL + body) plus every directory search term.
 */
function mockFetchRouting(opts: Routing = {}) {
  const submitApprovalCalls: Array<{ url: string; body: unknown }> = [];
  const fromModuleCalls: Array<{ url: string; body: unknown }> = [];
  const searches: string[] = [];
  const directory = opts.directory ?? DIRECTORY;
  vi.spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/hrms/me/profile")) return Promise.resolve(jsonResponse(ME));
    if (url.includes("/transfer/submit-approval")) {
      submitApprovalCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve((opts.submitApproval ?? (() => jsonResponse({ id: "transfer-1", status: "accepted" })))());
    }
    if (url.includes("/estab/files/from-module")) {
      fromModuleCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve((opts.fromModule ?? (() => jsonResponse({ fileNo: "HR/2026/001" })))());
    }
    if (url.includes("/hrms/employees?")) {
      const params = new URL(url, "http://x").searchParams;
      if (params.has("ids")) {
        const ids = (params.get("ids") ?? "").split(",");
        return Promise.resolve(jsonResponse({ data: directory.filter((r) => ids.includes(r.id)) }));
      }
      const q = params.get("q") ?? "";
      searches.push(q);
      const custom = opts.employeeSearch?.(q);
      if (custom) return Promise.resolve(custom);
      const limit = Number(params.get("limit") ?? 20);
      return Promise.resolve(jsonResponse({ data: directory.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())).slice(0, limit) }));
    }
    if (url.includes("/hrms/departments?")) return Promise.resolve((opts.departments ?? (() => jsonResponse({ data: DEPARTMENTS })))());
    if (url.includes("/payroll/structures?")) return Promise.resolve(jsonResponse({ data: PAY_STRUCTURES }));
    return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
  }) as typeof fetch);
  return { submitApprovalCalls, fromModuleCalls, searches };
}

/** Types into an EmployeePicker and clicks the matching result (same interaction as the picker's own tests). */
async function pickEmployee(label: RegExp, query: string, optionText: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: query } });
  fireEvent.mouseDown(await screen.findByText(optionText));
}

const nextBtn = () => screen.getByRole("button", { name: "Next: Approval routing →" });

async function fillStep1(employee = { query: "Asha", option: "Asha Verma (E-001)" }) {
  fireEvent.click(screen.getByRole("button", { name: "+ Transfer with approval" }));
  await pickEmployee(/^Employee/, employee.query, employee.option);
  await waitFor(() => expect(screen.getByRole("option", { name: "Works" })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/^Transfer to \(department\)/), { target: { value: "dept-2" } });
  fireEvent.change(screen.getByLabelText(/^Effective date/), { target: { value: "2026-09-01" } });
}

async function openAndFillWizard() {
  await fillStep1();
  await waitFor(() => expect(screen.getByLabelText("Current department (auto-filled)")).toHaveValue("Finance"));
  fireEvent.click(nextBtn());

  // The initiator is the signed-in employee, shown read-only (the estab route rejects any other initiator).
  await waitFor(() => expect(screen.getByLabelText(/^Initiating officer/)).toHaveValue("Meera Self (E-009)"));
  await pickEmployee(/^Forward to \(approving officer\)/, "Iyer", "P. Iyer (E-020)");
  fireEvent.change(screen.getByPlaceholderText(/Why is this transfer being initiated/), {
    target: { value: "Administrative requirement" },
  });
}

describe("TransferWithApproval", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    toastSuccess.mockReset();
  });

  it("does not create a second transfer request when retrying after the eFile step fails", async () => {
    const { submitApprovalCalls, fromModuleCalls } = mockFetchRouting({
      submitApproval: () => jsonResponse({ id: "transfer-abc", status: "accepted" }),
      // Empty body on purpose: exercises the component's own fallback message
      // rather than a server-supplied one (matches the real, live-observed
      // failure mode — the estab service being unreachable returns a JSON
      // error body through the gateway, but the proxy/estab-down case this
      // guards can surface with no body at all).
      fromModule: () => new Response("", { status: 502 }),
    });

    render(<TransferWithApproval />);
    await openAndFillWizard();

    fireEvent.click(screen.getByRole("button", { name: "Submit transfer to eOffice" }));
    await waitFor(() => expect(screen.getByText(/raising the eFile failed/)).toBeInTheDocument());
    expect(submitApprovalCalls).toHaveLength(1);
    expect(fromModuleCalls).toHaveLength(1);

    // Retry after the failure: the banner should say the request already
    // exists, and the retry must only hit the eFile endpoint again — it must
    // NOT call submit-approval a second time (that would be a duplicate
    // pending_approval transfer request for the same employee).
    expect(screen.getByText(/already created/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Submit transfer to eOffice" }));
    await waitFor(() => expect(fromModuleCalls).toHaveLength(2));

    expect(submitApprovalCalls).toHaveLength(1);
    // Both eFile attempts must reference the SAME transfer id from step 1.
    expect(fromModuleCalls[0]!.body).toMatchObject({ refId: "transfer-abc" });
    expect(fromModuleCalls[1]!.body).toMatchObject({ refId: "transfer-abc" });
  });

  it("always raises the eFile with the signed-in employee as initiator, and the field is read-only", async () => {
    const { fromModuleCalls } = mockFetchRouting({
      submitApproval: () => jsonResponse({ id: "transfer-self", status: "accepted" }),
      fromModule: () => jsonResponse({ fileNo: "HR/2026/003" }),
    });
    render(<TransferWithApproval />);
    await openAndFillWizard();
    expect(screen.getByLabelText(/^Initiating officer/)).toHaveAttribute("readonly");
    fireEvent.click(screen.getByRole("button", { name: "Submit transfer to eOffice" }));
    await waitFor(() => expect(fromModuleCalls).toHaveLength(1));
    expect(fromModuleCalls[0]!.body).toMatchObject({ initiatedBy: ME.id, currentWith: "emp-off-2" });
  });

  it("raises the eFile and shows a success toast on the happy path", async () => {
    const { submitApprovalCalls, fromModuleCalls } = mockFetchRouting({
      submitApproval: () => jsonResponse({ id: "transfer-xyz", status: "accepted" }),
      fromModule: () => jsonResponse({ fileNo: "HR/2026/001" }),
    });

    render(<TransferWithApproval />);
    await openAndFillWizard();
    fireEvent.click(screen.getByRole("button", { name: "Submit transfer to eOffice" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining("HR/2026/001")));
    expect(submitApprovalCalls).toHaveLength(1);
    expect(fromModuleCalls).toHaveLength(1);
    // Wizard closes and resets on success.
    expect(screen.getByRole("button", { name: "+ Transfer with approval" })).toBeInTheDocument();
  });

  // HIGH fix (PR #1552 review): the backend has accepted an optional
  // payStructureId on both transfer paths for a while, but the actual form
  // never sent one, so nothing changed for real users. These two tests prove
  // the field is both present and functional in the UI, and genuinely optional.
  it("sends the selected pay structure in the submit-approval request body", async () => {
    const { submitApprovalCalls } = mockFetchRouting({
      submitApproval: () => jsonResponse({ id: "transfer-ps1", status: "accepted" }),
      fromModule: () => jsonResponse({ fileNo: "HR/2026/002" }),
    });

    render(<TransferWithApproval />);
    await openAndFillWizard(); // does not touch pay structure -- filled in below

    // openAndFillWizard already advanced to step 2 (the selector only exists
    // in step 1); go back, select a pay structure, then forward again.
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    await waitFor(() => expect(screen.getByRole("option", { name: /Pay Level 6/ })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("New pay structure (optional)"), { target: { value: "ps-2" } });
    fireEvent.click(nextBtn());

    fireEvent.click(screen.getByRole("button", { name: "Submit transfer to eOffice" }));
    await waitFor(() => expect(submitApprovalCalls).toHaveLength(1));

    expect(submitApprovalCalls[0]!.body).toMatchObject({
      fromDeptId: "dept-1", toDeptId: "dept-2", effectiveDate: "2026-09-01", payStructureId: "ps-2",
    });
  });

  it("omits payStructureId entirely when left as 'No change' — optional, not required", async () => {
    const { submitApprovalCalls } = mockFetchRouting({
      submitApproval: () => jsonResponse({ id: "transfer-nops", status: "accepted" }),
      fromModule: () => jsonResponse({ fileNo: "HR/2026/003" }),
    });

    render(<TransferWithApproval />);
    await openAndFillWizard();
    fireEvent.click(screen.getByRole("button", { name: "Submit transfer to eOffice" }));
    await waitFor(() => expect(submitApprovalCalls).toHaveLength(1));

    const body = submitApprovalCalls[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ fromDeptId: "dept-1", toDeptId: "dept-2", effectiveDate: "2026-09-01" });
    expect(Object.prototype.hasOwnProperty.call(body, "payStructureId")).toBe(false);
  });

  // GAP-HR-TRANSFER-09: employee detail's "Initiate Transfer" quick action
  // previously opened this wizard closed and blank regardless of ?empId=.
  it("opens pre-selected and pre-filled for a prefilled employee, department resolved from the directory", async () => {
    mockFetchRouting();

    render(<TransferWithApproval prefillEmployee={{ id: "emp-1", name: "Asha Verma" }} />);

    // Opens already expanded -- no click on "+ Transfer with approval" needed.
    expect(screen.getByRole("heading", { name: "Raise a transfer for eOffice approval" })).toBeInTheDocument();
    // The prefilled employee is shown by NAME in the picker (never an id), even though no search was typed.
    await waitFor(() => expect((screen.getByLabelText(/^Employee/) as HTMLInputElement).value).toMatch(/Asha Verma/));
    await waitFor(() => expect(screen.getByLabelText("Current department (auto-filled)")).toHaveValue("Finance"));
  });

  // GAP-HR-TRANSFER-06: a failed departments/officers fetch used to silently
  // fall back to a raw "Department ID" / "Officer ID" text input -- asking a
  // clerk to type a UUID with no guidance on where to find one.
  describe("lookups never fall back to raw-id text inputs (GAP-HR-TRANSFER-06)", () => {
    it("with the departments fetch rejected: no 'Department ID' input, a retry control, and Next is disabled", async () => {
      mockFetchRouting({ departments: () => new Response("", { status: 500 }) });

      render(<TransferWithApproval />);
      fireEvent.click(screen.getByRole("button", { name: "+ Transfer with approval" }));

      await waitFor(() => expect(screen.getByText("Couldn't load departments.")).toBeInTheDocument());
      expect(screen.queryByPlaceholderText(/Department ID/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Department ID/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
      expect(nextBtn()).toBeDisabled();
    });

    it("Retry reloads the departments and enables Next once they have loaded", async () => {
      let attempts = 0;
      mockFetchRouting({ departments: () => (++attempts === 1 ? new Response("", { status: 500 }) : jsonResponse({ data: DEPARTMENTS })) });

      render(<TransferWithApproval />);
      fireEvent.click(screen.getByRole("button", { name: "+ Transfer with approval" }));
      fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

      await waitFor(() => expect(screen.getByRole("option", { name: "Works" })).toBeInTheDocument());
      expect(screen.queryByText("Couldn't load departments.")).not.toBeInTheDocument();
      expect(nextBtn()).toBeEnabled();
    });

    it("keeps Next disabled until the departments list has loaded", async () => {
      let release: (r: Response) => void = () => undefined;
      mockFetchRouting({ departments: () => new Promise<Response>((resolve) => { release = resolve; }) });

      render(<TransferWithApproval />);
      fireEvent.click(screen.getByRole("button", { name: "+ Transfer with approval" }));

      expect(await screen.findByRole("option", { name: "Loading departments…" })).toBeInTheDocument();
      expect(nextBtn()).toBeDisabled();
      expect(screen.queryByPlaceholderText(/Department ID/i)).not.toBeInTheDocument();

      release(jsonResponse({ data: DEPARTMENTS }));
      await waitFor(() => expect(nextBtn()).toBeEnabled());
    });

    it("a real 403 on departments is a permission message, not an endless retry", async () => {
      mockFetchRouting({ departments: () => new Response("", { status: 403 }) });

      render(<TransferWithApproval />);
      fireEvent.click(screen.getByRole("button", { name: "+ Transfer with approval" }));

      expect(await screen.findByText("You don't have permission to view departments.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
      expect(nextBtn()).toBeDisabled();
    });

    it("searches employees on the server, so the 250th of 300 is reachable (no limit=200 list)", async () => {
      const crowd: DirRow[] = Array.from({ length: 300 }, (_, i) => ({
        id: `emp-${i + 1}`, employeeNo: `E-${String(i + 1).padStart(3, "0")}`, name: `Staff Member ${i + 1}`, department: "Finance",
      }));
      const { searches } = mockFetchRouting({ directory: crowd });

      render(<TransferWithApproval />);
      fireEvent.click(screen.getByRole("button", { name: "+ Transfer with approval" }));
      await pickEmployee(/^Employee/, "Staff Member 250", "Staff Member 250 (E-250)");

      expect(searches).toContain("Staff Member 250");
      await waitFor(() => expect(screen.getByLabelText("Current department (auto-filled)")).toHaveValue("Finance"));
    });

    it("a failed employee search is an error with a working Retry -- never a silent 'No matches'", async () => {
      let calls = 0;
      mockFetchRouting({ employeeSearch: () => (++calls === 1 ? new Response("", { status: 500 }) : null) });

      render(<TransferWithApproval />);
      fireEvent.click(screen.getByRole("button", { name: "+ Transfer with approval" }));
      fireEvent.change(screen.getByLabelText(/^Employee/), { target: { value: "Asha" } });

      expect(await screen.findByText(/Could not load employees/)).toBeInTheDocument();
      expect(screen.queryByText("No matching employees")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      fireEvent.mouseDown(await screen.findByText("Asha Verma (E-001)"));
      await waitFor(() => expect(screen.getByLabelText("Current department (auto-filled)")).toHaveValue("Finance"));
    });
  });

  // GAP-HR-TRANSFER-06 step 5: the "From" department is a name, or "Not
  // available" -- never a raw id -- and the wizard refuses to continue
  // instead of sending an empty fromDeptId (the backend 400s on it).
  describe("current department must be known (GAP-HR-TRANSFER-06)", () => {
    it.each([
      ["no department on the employee record", { query: "Nameless", option: "Nameless Dept (E-030)" }],
      ["a department that is not in the tenant's list", { query: "Ghost", option: "Ghost Wing (E-031)" }],
    ])("shows 'Not available' and blocks Next for %s", async (_label, employee) => {
      const { submitApprovalCalls } = mockFetchRouting();
      render(<TransferWithApproval />);
      await fillStep1(employee);

      expect(screen.getByLabelText("Current department (auto-filled)")).toHaveValue("Not available");
      fireEvent.click(nextBtn());

      expect(await screen.findByText(/current department could not be determined/i)).toBeInTheDocument();
      // still on step 1: the approval-routing step was never reached
      expect(screen.queryByLabelText(/^Initiating officer/)).not.toBeInTheDocument();
      expect(submitApprovalCalls).toHaveLength(0);
    });

    it("treats a department name shared by two departments as unknown rather than guessing", async () => {
      mockFetchRouting({ departments: () => jsonResponse({ data: [...DEPARTMENTS, { id: "dept-3", name: "Finance" }] }) });
      render(<TransferWithApproval />);
      fireEvent.click(screen.getByRole("button", { name: "+ Transfer with approval" }));
      await pickEmployee(/^Employee/, "Asha", "Asha Verma (E-001)");
      await waitFor(() => expect(screen.getByLabelText("Current department (auto-filled)")).toHaveValue("Not available"));
    });

    it("rejects a destination equal to the current department", async () => {
      mockFetchRouting();
      render(<TransferWithApproval />);
      fireEvent.click(screen.getByRole("button", { name: "+ Transfer with approval" }));
      await waitFor(() => expect(screen.getByRole("option", { name: "Works" })).toBeInTheDocument());
      // choose the destination first, then an employee who already works there
      fireEvent.change(screen.getByLabelText(/^Transfer to \(department\)/), { target: { value: "dept-2" } });
      await pickEmployee(/^Employee/, "Iyer", "P. Iyer (E-020)");
      await waitFor(() => expect(screen.getByLabelText("Current department (auto-filled)")).toHaveValue("Works"));
      fireEvent.change(screen.getByLabelText(/^Effective date/), { target: { value: "2026-09-01" } });
      fireEvent.click(nextBtn());
      expect(await screen.findByText(/must be different from the current department/)).toBeInTheDocument();
    });
  });
});
