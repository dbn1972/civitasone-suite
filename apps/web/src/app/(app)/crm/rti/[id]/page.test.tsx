import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

import type { ReactElement } from "react";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}


const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// GAP-CRM-RTI-DETAIL-02/03: the page now reads the session roles to gate
// actions and PII. Mock the shared guard so tests can set the viewer's roles.
const getSessionRolesMock = vi.fn<() => string[]>(() => ["crm_user"]);
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => getSessionRolesMock() };
});

import RtiDetailPage from "./page";

const RTI = {
  id: "9e10b6c1-2222-4444-8888-000000000001",
  referenceNo: "RTI/2026/FINAN/ABC123",
  section: "s.6",
  departmentRef: "Ministry of Finance",
  applicantName: "Anil Sharma",
  applicantContact: "9876500000",
  subject: "Copy of sanctioned budget",
  description: "Please provide the FY26 budget breakup.",
  status: "RECEIVED",
  feePaid: true,
  feeAmount: 10,
  feeAmountMinor: "1010",
  mode: "post",
  receivedAt: "2026-08-01T00:00:00.000Z",
  dueAt: "2026-08-31T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("RtiDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReset();
    getSessionRolesMock.mockReturnValue(["crm_user"]);
  });

  it("renders the RTI request detail and its lifecycle actions for a CRM user", async () => {
    fetchJsonMock.mockResolvedValue({ data: RTI, source: "api" });

    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getAllByText(RTI.referenceNo).length).toBeGreaterThan(0);
    expect(screen.getByText(RTI.applicantName)).toBeInTheDocument();
    expect(screen.getByText(RTI.description)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forward" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Respond" })).toBeInTheDocument();
  });

  // GAP-CRM-RTI-NEW-01: fee rendered from paise via formatMoney (₹10.10), not
  // the raw rupees number.
  it("renders the fee from paise with ₹ formatting", async () => {
    fetchJsonMock.mockResolvedValue({ data: RTI, source: "api" });
    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.getByText(/Paid — ₹10\.10/)).toBeInTheDocument();
  });

  // GAP-CRM-RTI-NEW-02: mode of receipt is surfaced.
  it("shows the mode of receipt", async () => {
    fetchJsonMock.mockResolvedValue({ data: RTI, source: "api" });
    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.getByText("By post")).toBeInTheDocument();
  });

  // GAP-CRM-RTI-DETAIL-05: a larger fee renders with Indian (lakh) grouping.
  it("formats a large fee with lakh grouping from paise", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { ...RTI, feeAmountMinor: "15000000", feeAmount: 150000 },
      source: "api",
    });
    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(ui);
    expect(screen.getByText(/Paid — ₹1,50,000\.00/)).toBeInTheDocument();
  });

  // GAP-CRM-RTI-DETAIL-05: fee paid but no amount shows "Paid", never "₹NaN".
  it("shows 'Paid' when fee is paid but the amount is missing", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { ...RTI, feePaid: true, feeAmount: undefined, feeAmountMinor: null },
      source: "api",
    });
    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(ui);
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  // GAP-CRM-RTI-DETAIL-03 / F1-02 + F1-06: the page asks the server for the
  // applicant name + contact MASKED for every viewer (?maskPii=true), so even a
  // PII-read role (crm_admin) sees the masked form first and reaches the clear
  // value only through the audited reveal (reason + pii_reveal audit event).
  describe("applicant PII: masked by default, audited reveal (GAP-CRM-RTI-DETAIL-03)", () => {
    const MASKED = { applicantName: "Anil S•••", applicantContact: "******0000" };

    afterEach(() => vi.restoreAllMocks());

    it("requests the detail with ?maskPii=true so no viewer is sent the clear value", async () => {
      getSessionRolesMock.mockReturnValue(["crm_admin"]);
      fetchJsonMock.mockResolvedValue({ data: { ...RTI, ...MASKED }, source: "api" });
      await RtiDetailPage({ params: { id: RTI.id } });
      expect(fetchJsonMock.mock.calls[0][0]).toBe(`/api/v1/crm/rti/${RTI.id}?maskPii=true`);
    });

    it("a PII-read role sees the masked values plus a Reveal control for each, and never the clear value", async () => {
      getSessionRolesMock.mockReturnValue(["crm_admin"]);
      fetchJsonMock.mockResolvedValue({ data: { ...RTI, ...MASKED }, source: "api" });
      const ui = await RtiDetailPage({ params: { id: RTI.id } });
      const { container } = render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
      expect(screen.getByText("Anil S•••")).toBeInTheDocument();
      expect(screen.getByText("******0000")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Reveal" })).toHaveLength(2);
      expect(container.textContent).not.toContain("Anil Sharma");
      expect(container.textContent).not.toContain("9876500000");
      expect(screen.getByText(/revealing a value needs a stated reason and is recorded in the audit log/i)).toBeInTheDocument();
    });

    it("Reveal asks for a reason, calls the audited endpoint for the RTI contact, then shows the clear value", async () => {
      getSessionRolesMock.mockReturnValue(["crm_admin"]);
      fetchJsonMock.mockResolvedValue({ data: { ...RTI, ...MASKED }, source: "api" });
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify({ data: { value: "9876500000" } }), { status: 200 }));
      const ui = await RtiDetailPage({ params: { id: RTI.id } });
      render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

      // The contact is the second Reveal control (name, then contact).
      fireEvent.click(screen.getAllByRole("button", { name: "Reveal" })[1]!);
      expect(fetchSpy).not.toHaveBeenCalled();
      fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "Need to send the response by phone" } });
      const dialog = screen.getByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Reveal" }));

      expect(await screen.findByText("9876500000")).toBeInTheDocument();
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/proxy/v1/crm/pii/reveal");
      expect(JSON.parse(init.body as string)).toEqual({
        resourceType: "rti",
        resourceId: RTI.id,
        field: "applicantContact",
        reason: "Need to send the response by phone",
      });
    });

    it("a role without PII access sees the masked values, NO Reveal button and the not-permitted notice", async () => {
      getSessionRolesMock.mockReturnValue(["crm_user"]);
      fetchJsonMock.mockResolvedValue({ data: { ...RTI, ...MASKED }, source: "api" });
      const ui = await RtiDetailPage({ params: { id: RTI.id } });
      render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
      expect(screen.getByText("Anil S•••")).toBeInTheDocument();
      expect(screen.getByText("******0000")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
      expect(screen.getByText(/you do not have permission to view the full contact/i)).toBeInTheDocument();
      // The old "Access is logged" claim must not appear for a viewer who cannot reveal anything.
      expect(screen.queryByText(/recorded in the audit log/i)).not.toBeInTheDocument();
    });
  });

  // GAP-CRM-RTI-DETAIL-04: a transferred request says where it came from and when.
  it("shows 'Transferred from X on <date>' when the API returns the previous department", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { ...RTI, status: "TRANSFERRED", departmentRef: "Department of Revenue", previousDepartmentRef: "Ministry of Finance", transferredAt: "2026-08-03T05:30:00.000Z" },
      source: "api",
    });
    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.getByText("Department of Revenue")).toBeInTheDocument();
    expect(screen.getByText(/Transferred from Ministry of Finance on /)).toBeInTheDocument();
  });

  it("omits the transfer line for a request that was never transferred", async () => {
    fetchJsonMock.mockResolvedValue({ data: { ...RTI, previousDepartmentRef: null, transferredAt: null }, source: "api" });
    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.queryByText(/Transferred from/)).not.toBeInTheDocument();
  });

  it("names the origin even when the transfer time was not recorded", async () => {
    fetchJsonMock.mockResolvedValue({ data: { ...RTI, previousDepartmentRef: "Ministry of Finance", transferredAt: null }, source: "api" });
    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.getByText("Transferred from Ministry of Finance")).toBeInTheDocument();
  });

  // GAP-CRM-RTI-06: the section reads exactly like the register table, the filter and the new form.
  it("renders the canonical full section label for s.6 and s.11", async () => {
    fetchJsonMock.mockResolvedValue({ data: RTI, source: "api" });
    const six = await RtiDetailPage({ params: { id: RTI.id } });
    const { unmount } = render(<NextIntlClientProvider locale="en" messages={enMessages}>{six}</NextIntlClientProvider>);
    expect(screen.getByText("§6 — Information Request")).toBeInTheDocument();
    unmount();
    fetchJsonMock.mockResolvedValue({ data: { ...RTI, section: "s.11" }, source: "api" });
    const eleven = await RtiDetailPage({ params: { id: RTI.id } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{eleven}</NextIntlClientProvider>);
    expect(screen.getByText("§11 — Third-party Information")).toBeInTheDocument();
  });

  it("renders the server-masked contact and hides actions for a viewer without a CRM role", async () => {
    getSessionRolesMock.mockReturnValue(["citizen"]);
    // The server returns the masked value for a non-PII role; the page renders it.
    fetchJsonMock.mockResolvedValue({ data: { ...RTI, applicantName: "Anil S•••", applicantContact: "******0000" }, source: "api" });
    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.queryByText("9876500000")).not.toBeInTheDocument();
    expect(screen.getByText("******0000")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Respond" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/do not have permission/i).length).toBeGreaterThan(0);
  });

  it("shows a not-found message instead of crashing for a bogus id", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "api" });

    const ui = await RtiDetailPage({ params: { id: "does-not-exist" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getAllByText("RTI request not found").length).toBeGreaterThan(0);
  });

  // GAP-CRM-RTI-DETAIL-06: a 404 is "not found", distinct from an outage.
  it("treats a 404 as not-found", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(ui);
    expect(screen.getAllByText("RTI request not found").length).toBeGreaterThan(0);
  });

  // GAP-CRM-RTI-DETAIL-06: a 500 is a retryable outage, NOT "not found".
  it("shows a retry error state (not 'not found') on a 500", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(ui);
    expect(screen.queryByText("RTI request not found")).not.toBeInTheDocument();
    // RefreshErrorState offers a Try again action.
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  // GAP-CRM-RTI-DETAIL-06: a 403 is "access restricted" (PermissionDenied),
  // never titled as a missing record and never offering a pointless retry.
  it("shows access-restricted (not 'not found') on a 403", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 403 });
    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(ui);
    expect(screen.queryByText("RTI request not found")).not.toBeInTheDocument();
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
  });

  it("does not claim a cached view when the fetch actually failed", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 500 });

    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    // Not a fabricated "not found" — an honest, retryable error state.
    expect(screen.queryByText("RTI request not found")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  // GAP-CRM-RTI-DETAIL-01: appeal chain wiring.
  it("offers Record FAA decision on a first appeal only to an appellate (admin) role", async () => {
    const appeal = { ...RTI, status: "FIRST_APPEAL", firstAppealDueAt: "2026-10-31T00:00:00.000Z" };
    fetchJsonMock.mockResolvedValue({ data: appeal, source: "api" });

    render(<NextIntlClientProvider locale="en" messages={enMessages}>{await RtiDetailPage({ params: { id: RTI.id } })}</NextIntlClientProvider>);
    expect(screen.queryByRole("button", { name: "Record FAA decision" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record second appeal" })).toBeInTheDocument();
  });

  it("shows the decide action to crm_admin", async () => {
    getSessionRolesMock.mockReturnValue(["crm_admin"]);
    fetchJsonMock.mockResolvedValue({ data: { ...RTI, status: "FIRST_APPEAL" }, source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{await RtiDetailPage({ params: { id: RTI.id } })}</NextIntlClientProvider>);
    expect(screen.getByRole("button", { name: "Record FAA decision" })).toBeInTheDocument();
  });

  it("renders the appeal & disposal record read-only for a disposed request", async () => {
    getSessionRolesMock.mockReturnValue(["crm_admin"]);
    fetchJsonMock.mockResolvedValue({
      data: {
        ...RTI,
        status: "DISPOSED",
        firstAppealOutcome: "allowed",
        firstAppealOrder: "Appeal allowed; furnish the budget breakup within 15 days.",
        firstAppealDecidedAt: "2026-09-20T05:00:00.000Z",
        disposedAt: "2026-10-02T05:00:00.000Z",
        disposalReason: "Information furnished as directed by the FAA.",
      },
      source: "api",
    });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{await RtiDetailPage({ params: { id: RTI.id } })}</NextIntlClientProvider>);
    expect(screen.getByText("Appeal & Disposal")).toBeInTheDocument();
    expect(screen.getByText(/Appeal allowed —/)).toBeInTheDocument();
    expect(screen.getByText("Appeal allowed; furnish the budget breakup within 15 days.")).toBeInTheDocument();
    expect(screen.getByText("Information furnished as directed by the FAA.")).toBeInTheDocument();
    expect(screen.getByText(/disposed \(on /i)).toBeInTheDocument();
    // No lifecycle action is offered on a disposed (read-only) record; the only buttons
    // left are the audited Reveal controls on the masked applicant data.
    const buttonLabels = screen.queryAllByRole("button").map((b) => b.textContent);
    expect(buttonLabels.length).toBeGreaterThan(0);
    expect(buttonLabels.every((label) => label === "Reveal")).toBe(true);
  });
});
