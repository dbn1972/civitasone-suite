import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

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
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
}));

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

  // GAP-CRM-RTI-DETAIL-03: a CRM user who needs it to reply sees the contact
  // in clear; an unprivileged viewer sees it masked and no action buttons.
  it("shows the contact in clear to a CRM user", async () => {
    getSessionRolesMock.mockReturnValue(["crm_user"]);
    fetchJsonMock.mockResolvedValue({ data: RTI, source: "api" });
    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.getByText("9876500000")).toBeInTheDocument();
    expect(screen.getByText(/Access is logged/)).toBeInTheDocument();
  });

  it("masks the contact and hides actions for a viewer without a CRM role", async () => {
    getSessionRolesMock.mockReturnValue(["citizen"]);
    fetchJsonMock.mockResolvedValue({ data: RTI, source: "api" });
    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.queryByText("9876500000")).not.toBeInTheDocument();
    expect(screen.getByText(/•••• 0000/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Respond" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/do not have permission/i).length).toBeGreaterThan(0);
  });

  it("shows a not-found message instead of crashing for a bogus id", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "api" });

    const ui = await RtiDetailPage({ params: { id: "does-not-exist" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("RTI Request Not Found")).toBeInTheDocument();
  });

  it("does not claim a cached view when the fetch actually failed", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });

    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("RTI Request Not Found")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
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
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
