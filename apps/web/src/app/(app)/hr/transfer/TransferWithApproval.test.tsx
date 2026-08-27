import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const toastSuccess = vi.fn();
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: toastSuccess, error: vi.fn(), info: vi.fn() } }),
}));

import { TransferWithApproval } from "./TransferWithApproval";

const EMPLOYEES = [
  { id: "emp-1", name: "Asha Verma", designation: "Clerk", departmentId: "dept-1", department: "Finance" },
];
const DEPARTMENTS = [
  { id: "dept-1", name: "Finance" },
  { id: "dept-2", name: "Works" },
];
const OFFICERS = [
  { id: "off-1", name: "S. Rao", designation: "Section Officer" },
  { id: "off-2", name: "P. Iyer", designation: "Under Secretary" },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Routes the three lookup GETs (employees/departments/identity users) to
 * fixed fixtures, and lets the test control what the two mutating calls
 * (submit-approval, from-module) return — while recording how many times
 * each was actually invoked, which is the thing the fix under test changes.
 */
function mockFetchRouting(opts: { submitApproval: () => Response; fromModule: () => Response }) {
  const submitApprovalCalls: string[] = [];
  const fromModuleCalls: Array<{ url: string; body: unknown }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/hrms/employees?")) return Promise.resolve(jsonResponse({ data: EMPLOYEES }));
    if (url.includes("/hrms/departments?")) return Promise.resolve(jsonResponse({ data: DEPARTMENTS }));
    if (url.includes("/identity/users?")) return Promise.resolve(jsonResponse({ data: OFFICERS }));
    if (url.includes("/transfer/submit-approval")) {
      submitApprovalCalls.push(url);
      return Promise.resolve(opts.submitApproval());
    }
    if (url.includes("/estab/files/from-module")) {
      fromModuleCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve(opts.fromModule());
    }
    return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
  }) as typeof fetch);
  return { submitApprovalCalls, fromModuleCalls };
}

async function openAndFillWizard() {
  fireEvent.click(screen.getByRole("button", { name: "+ Transfer with approval" }));
  await waitFor(() => expect(screen.getByRole("option", { name: /Asha Verma/ })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Employee"), { target: { value: "emp-1" } });
  await waitFor(() => expect(screen.getByRole("option", { name: "Works" })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Transfer to (department)"), { target: { value: "dept-2" } });
  fireEvent.change(screen.getByLabelText("Effective date"), { target: { value: "2026-09-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Next: Approval routing →" }));

  await waitFor(() =>
    expect(within(screen.getByLabelText("Initiating officer")).getByRole("option", { name: /S\. Rao/ })).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByLabelText("Initiating officer"), { target: { value: "off-1" } });
  fireEvent.change(screen.getByLabelText("Forward to (approving officer)"), { target: { value: "off-2" } });
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
});
