import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const toastSuccess = vi.fn();
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: toastSuccess, error: vi.fn(), info: vi.fn() } }),
}));

import { PromoteWithApproval } from "./PromoteWithApproval";

const EMPLOYEES = [
  { id: "emp-1", name: "Asha Verma", designation: "Section Officer", designationId: "desig-1" },
];
const DESIGNATIONS = [
  { id: "desig-1", name: "Section Officer", grade: "7" },
  { id: "desig-2", name: "Under Secretary", grade: "8" },
];
const OFFICERS = [
  { id: "off-1", name: "S. Rao", designation: "Under Secretary" },
  { id: "off-2", name: "P. Iyer", designation: "Deputy Secretary" },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function mockFetchRouting(opts: { submitApproval: () => Response; fromModule: () => Response }) {
  const submitApprovalCalls: string[] = [];
  const fromModuleCalls: Array<{ url: string; body: unknown }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/hrms/employees?")) return Promise.resolve(jsonResponse({ data: EMPLOYEES }));
    if (url.includes("/hrms/designations?")) return Promise.resolve(jsonResponse({ data: DESIGNATIONS }));
    if (url.includes("/identity/users?")) return Promise.resolve(jsonResponse({ data: OFFICERS }));
    if (url.includes("/promotion/submit-approval")) {
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
  fireEvent.click(screen.getByRole("button", { name: "+ Promotion with approval" }));
  await waitFor(() => expect(screen.getByRole("option", { name: /Asha Verma/ })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Employee"), { target: { value: "emp-1" } });
  await waitFor(() => expect(screen.getByRole("option", { name: /Under Secretary \(Grade 8\)/ })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Promote to (new designation)"), { target: { value: "desig-2" } });
  fireEvent.change(screen.getByLabelText("Effective date"), { target: { value: "2026-09-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Next: Approval routing →" }));

  await waitFor(() =>
    expect(within(screen.getByLabelText("Initiating officer")).getByRole("option", { name: /S\. Rao/ })).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByLabelText("Initiating officer"), { target: { value: "off-1" } });
  fireEvent.change(screen.getByLabelText("Forward to (approving officer)"), { target: { value: "off-2" } });
  fireEvent.change(screen.getByPlaceholderText(/Why is this promotion being recommended/), {
    target: { value: "Meets DPC criteria" },
  });
}

describe("PromoteWithApproval", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    toastSuccess.mockReset();
  });

  it("does not create a second promotion request when retrying after the eFile step fails", async () => {
    const { submitApprovalCalls, fromModuleCalls } = mockFetchRouting({
      submitApproval: () => jsonResponse({ id: "promo-abc", status: "accepted" }),
      // Empty body on purpose: exercises the component's own fallback message.
      fromModule: () => new Response("", { status: 502 }),
    });

    render(<PromoteWithApproval />);
    await openAndFillWizard();

    fireEvent.click(screen.getByRole("button", { name: "Submit promotion to eOffice" }));
    await waitFor(() => expect(screen.getByText(/raising the eFile failed/)).toBeInTheDocument());
    expect(submitApprovalCalls).toHaveLength(1);

    expect(screen.getByText(/already created/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Submit promotion to eOffice" }));
    await waitFor(() => expect(fromModuleCalls).toHaveLength(2));

    // The key regression this guards: no duplicate pending_approval promotion
    // request gets created just because the eFile step failed once.
    expect(submitApprovalCalls).toHaveLength(1);
    expect(fromModuleCalls[0]!.body).toMatchObject({ refId: "promo-abc" });
    expect(fromModuleCalls[1]!.body).toMatchObject({ refId: "promo-abc" });
  });

  it("raises the eFile and shows a success toast on the happy path", async () => {
    const { submitApprovalCalls } = mockFetchRouting({
      submitApproval: () => jsonResponse({ id: "promo-xyz", status: "accepted" }),
      fromModule: () => jsonResponse({ fileNo: "HR/2026/002" }),
    });

    render(<PromoteWithApproval />);
    await openAndFillWizard();
    fireEvent.click(screen.getByRole("button", { name: "Submit promotion to eOffice" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining("HR/2026/002")));
    expect(submitApprovalCalls).toHaveLength(1);
    expect(screen.getByRole("button", { name: "+ Promotion with approval" })).toBeInTheDocument();
  });
});
