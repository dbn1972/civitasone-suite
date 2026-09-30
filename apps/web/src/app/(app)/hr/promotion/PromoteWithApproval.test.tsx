import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const toastSuccess = vi.fn();
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: toastSuccess, error: vi.fn(), info: vi.fn() } }),
}));

import { PromoteWithApproval } from "./PromoteWithApproval";

const EMPLOYEE_DETAIL = { id: "emp-1", designation: "Section Officer" };
const EMPLOYEES = [{ id: "emp-1", employeeNo: "E001", name: "Asha Verma", department: "Home" }];
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
    // GAP-HR-PROMOTION-05 test-mock ordering: the submit-approval and
    // from-module URLs both contain "/hrms/employees" as a substring
    // ("…/employees/emp-1/promotion/submit-approval"), so the generic
    // employee-list/detail branches below must never see them -- check the
    // most specific paths FIRST, not last, or a broad `.includes()` check
    // earlier in this chain silently swallows them (caught by this test
    // itself: submitApprovalCalls stayed empty while the component sailed
    // on with an unrelated 200's coincidental `id`, or none at all).
    if (url.includes("/promotion/submit-approval")) {
      submitApprovalCalls.push(url);
      return Promise.resolve(opts.submitApproval());
    }
    if (url.includes("/estab/files/from-module")) {
      fromModuleCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve(opts.fromModule());
    }
    // Employee/designation/officer search+resolve, and the current-
    // designation detail lookup -- see PromoteWithApproval.tsx's own file
    // header comment on why designationId itself is unavailable.
    if (url.endsWith(`/hrms/employees/emp-1`) && (!init?.method || init.method === "GET")) return Promise.resolve(jsonResponse(EMPLOYEE_DETAIL));
    if (url.includes("/hrms/employees")) return Promise.resolve(jsonResponse({ data: EMPLOYEES }));
    if (url.includes("/hrms/designations")) return Promise.resolve(jsonResponse({ data: DESIGNATIONS }));
    if (url.includes("/identity/users")) return Promise.resolve(jsonResponse({ data: OFFICERS }));
    return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
  }) as typeof fetch);
  return { submitApprovalCalls, fromModuleCalls };
}

// UX-017: PromoteWithApproval reads its copy through next-intl
// (useTranslations("promotionApprove")), so it needs a real provider in the
// tree — same pattern as hr/employees/[id]/edit/EditEmployeeForm.test.tsx.
function renderWidget() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PromoteWithApproval />
    </NextIntlClientProvider>,
  );
}

// GAP-HR-PROMOTION-05: employee/designation/officer are now EntityPicker
// searches, not plain <select>s -- select an option by typing enough of its
// label to match, then clicking the result (same interaction pattern as
// ds/EntityPicker.test.tsx itself).
async function pickEntity(fieldLabel: string, query: string, optionText: string) {
  const input = screen.getByLabelText(fieldLabel);
  fireEvent.change(input, { target: { value: query } });
  fireEvent.mouseDown(await screen.findByText(optionText));
}

async function openAndFillWizard() {
  fireEvent.click(screen.getByRole("button", { name: "+ Promotion with approval" }));

  await pickEntity("Employee", "Asha", "Asha Verma (E001)");
  await waitFor(() => expect(screen.getByLabelText("Current designation (auto-filled)")).toHaveValue("Section Officer"));
  await pickEntity("Promote to (new designation)", "Under", "Under Secretary");
  fireEvent.change(screen.getByLabelText("Effective date"), { target: { value: "2026-09-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Next: Approval routing →" }));

  await pickEntity("Initiating officer", "Rao", "S. Rao");
  await pickEntity("Forward to (approving officer)", "Iyer", "P. Iyer");
  fireEvent.change(screen.getByPlaceholderText(/Why is this promotion being recommended/), {
    target: { value: "Meets DPC criteria" },
  });
}

async function submitAndConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "Submit promotion to eOffice" }));
  // GAP-HR-PROMOTION-03: submit no longer fires the request directly -- it
  // opens a confirmation dialog first (a confidential eFile action had none).
  // The dialog's own confirm button has a distinct label from the trigger
  // specifically so a test (and a screen-reader user) never has to
  // disambiguate two same-named buttons on screen at once.
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: enMessages.promotionApprove.confirmRaiseConfirmBtn }));
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

    renderWidget();
    await openAndFillWizard();
    await submitAndConfirm();

    await waitFor(() => expect(submitApprovalCalls).toHaveLength(1));
    await waitFor(() => expect(fromModuleCalls).toHaveLength(1));
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());

    // Retry: only the eFile step re-runs, not step 1.
    await submitAndConfirm();
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

    renderWidget();
    await openAndFillWizard();
    await submitAndConfirm();

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining("HR/2026/002")));
    expect(submitApprovalCalls).toHaveLength(1);
    expect(screen.getByRole("button", { name: "+ Promotion with approval" })).toBeInTheDocument();
  });

  // GAP-HR-PROMOTION-05: an implausibly far-future effective date is blocked
  // client-side as a likely data-entry error, before any request is made.
  it("blocks an effective date implausibly far in the future", async () => {
    mockFetchRouting({
      submitApproval: () => jsonResponse({ id: "promo-abc" }),
      fromModule: () => jsonResponse({}),
    });
    renderWidget();
    fireEvent.click(screen.getByRole("button", { name: "+ Promotion with approval" }));
    await pickEntity("Employee", "Asha", "Asha Verma (E001)");
    await pickEntity("Promote to (new designation)", "Under", "Under Secretary");
    fireEvent.change(screen.getByLabelText("Effective date"), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Next: Approval routing →" }));

    expect(await screen.findByText(/too far in the future/i)).toBeInTheDocument();
    // Still on step 1 -- never reached the officer-picker step.
    expect(screen.queryByLabelText("Initiating officer")).not.toBeInTheDocument();
  });

  // GAP-HR-PROMOTION-03: wizard button must not even appear for a non-HR
  // viewer -- covered at the page.tsx level (role check there); this
  // component itself has no role awareness of its own, by design (it's
  // rendered conditionally by its caller).
});
