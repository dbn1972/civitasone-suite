import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }),
}));

import { PromoteWithApproval } from "./PromoteWithApproval";

// CLOS2-S2-07: the far-future cutoff is today (IST) + MAX_FUTURE_YEARS, not the UTC date.
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

async function attempt(effective: string) {
  render(<NextIntlClientProvider locale="en" messages={enMessages}><PromoteWithApproval /></NextIntlClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "+ Promotion with approval" }));
  const emp = screen.getByLabelText(/^Employee/);
  fireEvent.change(emp, { target: { value: "Asha" } });
  fireEvent.mouseDown(await screen.findByText("Asha Verma (E001)"));
  await waitFor(() => expect(screen.getByLabelText("Current designation (auto-filled)")).toHaveValue("Section Officer"));
  fireEvent.change(screen.getByLabelText(/^Promote to/), { target: { value: "Under" } });
  fireEvent.mouseDown(await screen.findByText("Under Secretary"));
  fireEvent.change(screen.getByLabelText(/^Effective date/), { target: { value: effective } });
  fireEvent.click(screen.getByRole("button", { name: "Next: Approval routing →" }));
}

describe("PromoteWithApproval far-future cutoff (IST)", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/hrms/employees/emp-1")) return Promise.resolve(json({ id: "emp-1", designation: "Section Officer" }));
      if (url.includes("/hrms/me/profile")) return Promise.resolve(json({ id: "me-1", fullName: "Meera Self", employeeNo: "E-009" }));
      if (url.includes("designation")) return Promise.resolve(json({ data: [{ id: "desig-2", name: "Under Secretary", grade: "8" }] }));
      if (url.includes("/hrms/employees")) return Promise.resolve(json({ data: [{ id: "emp-1", employeeNo: "E001", name: "Asha Verma", department: "Home" }] }));
      return Promise.resolve(json({ data: [] }));
    }) as typeof fetch);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T20:30:00Z")); // 02:00 IST on 2026-10-23
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("accepts the IST date exactly 3 years ahead", async () => {
    await attempt("2029-10-23");
    await waitFor(() => expect(screen.getByLabelText(/^Initiating officer/)).toBeInTheDocument());
    expect(screen.queryByText(enMessages.promotionApprove.errEffectiveDateTooFar)).not.toBeInTheDocument();
  });

  it("rejects one day beyond that", async () => {
    await attempt("2029-10-24");
    expect(await screen.findByText(enMessages.promotionApprove.errEffectiveDateTooFar)).toBeInTheDocument();
  });
});
