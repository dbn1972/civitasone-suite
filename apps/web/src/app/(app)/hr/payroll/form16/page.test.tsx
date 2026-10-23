import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// GAP-PAYROLL-FORM16-06: page now gates the bulk wizard/status card to
// payroll_admin/super_admin (this page previously had no check at all, and
// nothing here narrows VerifyForm16Form, which stays open to any
// authenticated role) -- default to an authorized role so the existing
// content tests below keep exercising the real page body; the dedicated
// gate test overrides this per-call.
const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn(() => ["payroll_admin"]) }));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: getSessionRolesMock,
}));

const statusAwareGetMock = vi.fn();
vi.mock("../_lib/statusAwareFetch", () => ({
  statusAwareGet: (...args: unknown[]) => statusAwareGetMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import Form16Page from "./page";

// UX-017: Form16Page (Server Component, getTranslations("form16")) also
// renders Form16Wizard, FyLookupForm and VerifyForm16Form -- all of which
// call useTranslations/getTranslations -- so every render needs a real
// NextIntlClientProvider in the tree, same pattern as
// hr/payroll/disbursement/page.test.tsx (tranche 9).
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("Form16Page", () => {
  beforeEach(() => {
    statusAwareGetMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("denies bulk generation to a role with no payroll admin privilege, without fetching bulk-status, but still shows Verify", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    const ui = await Form16Page({ searchParams: Promise.resolve({}) });
    renderPage(ui);
    expect(screen.getByText(/don.t have permission/i)).toBeInTheDocument();
    expect(statusAwareGetMock).not.toHaveBeenCalled();
    // GAP-PAYROLL-FORM16-06: form16/verify is "any authenticated user" on
    // the backend -- gating the bulk wizard must not also hide this.
    expect(screen.getByText("Verify a Form-16")).toBeInTheDocument();
  });

  it("renders the bulk job status when one exists for the FY", async () => {
    statusAwareGetMock.mockResolvedValue({
      kind: "ok",
      status: 200,
      body: {
        data: {
          jobId: "job-1",
          fy: "2025-26",
          status: "completed",
          totalEmployees: 10,
          generated: 10,
          failed: 0,
          storagePrefix: "form16/2025-26",
          errorDetails: null,
          createdAt: "2026-04-01T00:00:00.000Z",
          completedAt: "2026-04-01T01:00:00.000Z",
        },
      },
    });

    const ui = await Form16Page({ searchParams: Promise.resolve({ fy: "2025-26" }) });
    renderPage(ui);

    expect(screen.getByText("job-1")).toBeInTheDocument();
    expect(screen.getByText("Total Employees")).toBeInTheDocument();
  });

  it("renders a legitimate empty state on a 404 (no job created yet)", async () => {
    statusAwareGetMock.mockResolvedValue({ kind: "http_error", status: 404, body: { code: "NOT_FOUND" } });

    const ui = await Form16Page({ searchParams: Promise.resolve({ fy: "2025-26" }) });
    renderPage(ui);

    expect(screen.getByText("No Form-16 filing run for FY 2025-26")).toBeInTheDocument();
  });

  it("renders the error affordance (not the empty-state copy) on a real failure like 403", async () => {
    statusAwareGetMock.mockResolvedValue({ kind: "http_error", status: 403, body: { code: "FORBIDDEN" } });

    const ui = await Form16Page({ searchParams: Promise.resolve({ fy: "2025-26" }) });
    renderPage(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    expect(screen.getByText("Could not load the Form-16 filing run for FY 2025-26")).toBeInTheDocument();
    expect(screen.queryByText("No Form-16 filing run for FY 2025-26")).not.toBeInTheDocument();
  });

  // GAP-PAYROLL-FORM16-05: bulk-status returns { employeeNo, reasonCode } rows
  // (payroll-service form16-pdf/failure-reasons.ts). The page maps each stable
  // code to translated copy and shows the HR-facing employee number.
  it("renders failure details as a parsed list of translated reasons, not raw JSON", async () => {
    statusAwareGetMock.mockResolvedValue({
      kind: "ok",
      status: 200,
      body: {
        data: {
          jobId: "job-2", fy: "2025-26", status: "completed",
          totalEmployees: 4, generated: 0, failed: 4,
          storagePrefix: "form16/2025-26",
          errorDetails: [
            { employeeNo: "EMP-0109", reasonCode: "DATA_UNAVAILABLE" },
            { employeeNo: "EMP-0110", reasonCode: "RENDERER_UNAVAILABLE" },
            { employeeNo: "EMP-0111", reasonCode: "SIGNING_FAILED" },
            { employeeNo: "EMP-0112", reasonCode: "STORAGE_ERROR" },
          ],
          errorDetailsTotal: 4,
          createdAt: "2026-04-01T00:00:00.000Z", completedAt: null,
        },
      },
    });
    const ui = await Form16Page({ searchParams: Promise.resolve({ fy: "2025-26" }) });
    renderPage(ui);
    fireEventClickSummary();
    expect(screen.getByText("EMP-0109: Salary or tax data could not be read for this employee.")).toBeInTheDocument();
    expect(screen.getByText("EMP-0110: The PDF renderer was unavailable.")).toBeInTheDocument();
    expect(screen.getByText("EMP-0111: The PDF could not be digitally signed.")).toBeInTheDocument();
    expect(screen.getByText("EMP-0112: The PDF could not be saved to storage.")).toBeInTheDocument();
    expect(screen.queryByText(/"employeeNo"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/more failure/)).not.toBeInTheDocument();
  });

  it("renders a run-level failure as 'Whole run' with the generic reason", async () => {
    statusAwareGetMock.mockResolvedValue({
      kind: "ok", status: 200,
      body: { data: {
        jobId: "job-4", fy: "2025-26", status: "failed", totalEmployees: 0, generated: 0, failed: 1,
        storagePrefix: null,
        errorDetails: [{ employeeNo: "N/A", reasonCode: "UNKNOWN" }],
        errorDetailsTotal: 1,
        createdAt: "2026-04-01T00:00:00.000Z", completedAt: null,
      } },
    });
    const ui = await Form16Page({ searchParams: Promise.resolve({ fy: "2025-26" }) });
    const { container } = render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    fireEventClickSummary();
    const item = container.querySelector("details li");
    expect(item?.textContent).toBe("Whole run: Reason not available. Contact an administrator with the Job ID above.");
  });

  // The page must stay safe against a payroll-service that still sends the old
  // shape (raw exception text + internal employee UUID). Neither may be rendered.
  it("never renders backend error text or the internal employee id, even if the service sends them", async () => {
    const uuid = "5b1c2d3e-0000-4000-8000-000000000e09";
    statusAwareGetMock.mockResolvedValue({
      kind: "ok", status: 200,
      body: { data: {
        jobId: "job-5", fy: "2025-26", status: "completed", totalEmployees: 3, generated: 0, failed: 3,
        storagePrefix: "form16/2025-26",
        errorDetails: [
          { employeeId: uuid, employeeNo: "EMP-0109", error: "connect ECONNREFUSED 10.0.3.7:5432 /srv/keys/signing.p12" },
          { employeeId: "e9", message: "Chromium crashed: /usr/lib/chromium/headless_shell" },
          { employeeNo: "EMP-0007", reasonCode: "SOMETHING_NEW", error: "S3 AccessDenied arn:aws:s3:::civitas-form16" },
        ],
        createdAt: "2026-04-01T00:00:00.000Z", completedAt: null,
      } },
    });
    const ui = await Form16Page({ searchParams: Promise.resolve({ fy: "2025-26" }) });
    const { container } = render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    fireEventClickSummary();
    const generic = "Reason not available. Contact an administrator with the Job ID above.";
    expect(screen.getByText(`EMP-0109: ${generic}`)).toBeInTheDocument();
    expect(screen.getByText(`An employee: ${generic}`)).toBeInTheDocument();
    expect(screen.getByText(`EMP-0007: ${generic}`)).toBeInTheDocument();
    const text = container.textContent ?? "";
    for (const leaked of [uuid, "ECONNREFUSED", "signing.p12", "Chromium", "headless_shell", "AccessDenied", "arn:aws", /\be9\b/]) {
      if (typeof leaked === "string") expect(text).not.toContain(leaked);
      else expect(text).not.toMatch(leaked);
    }
  });

  it("caps the list and says how many failures are not shown", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ employeeNo: `EMP-${String(i).padStart(4, "0")}`, reasonCode: "STORAGE_ERROR" }));
    statusAwareGetMock.mockResolvedValue({
      kind: "ok", status: 200,
      body: { data: {
        jobId: "job-7", fy: "2025-26", status: "completed", totalEmployees: 500, generated: 0, failed: 500,
        storagePrefix: "form16/2025-26",
        errorDetails: rows,
        errorDetailsTotal: 500,
        createdAt: "2026-04-01T00:00:00.000Z", completedAt: null,
      } },
    });
    const ui = await Form16Page({ searchParams: Promise.resolve({ fy: "2025-26" }) });
    const { container } = render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    fireEventClickSummary();
    expect(container.querySelectorAll("details li")).toHaveLength(100);
    expect(screen.getByText("400 more failures are not shown.")).toBeInTheDocument();
  });

  it("falls back to the generic reason for an entry with no reason code", async () => {
    statusAwareGetMock.mockResolvedValue({
      kind: "ok", status: 200,
      body: { data: {
        jobId: "job-6", fy: "2025-26", status: "completed", totalEmployees: 2, generated: 1, failed: 1,
        storagePrefix: "form16/2025-26",
        errorDetails: [{ employeeNo: "EMP-0007" }],
        createdAt: "2026-04-01T00:00:00.000Z", completedAt: null,
      } },
    });
    const ui = await Form16Page({ searchParams: Promise.resolve({ fy: "2025-26" }) });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    fireEventClickSummary();
    expect(screen.getByText("EMP-0007: Reason not available. Contact an administrator with the Job ID above.")).toBeInTheDocument();
  });

  // GAP-PAYROLL-FORM16-05: an unrecognized errorDetails shape must fall
  // back to the failure count, never a raw dump.
  it("falls back to a safe message (not raw JSON) when errorDetails doesn't match the expected shape", async () => {
    statusAwareGetMock.mockResolvedValue({
      kind: "ok",
      status: 200,
      body: {
        data: {
          jobId: "job-3", fy: "2025-26", status: "completed",
          totalEmployees: 2, generated: 1, failed: 1,
          storagePrefix: "form16/2025-26",
          errorDetails: { somethingElse: true },
          createdAt: "2026-04-01T00:00:00.000Z", completedAt: null,
        },
      },
    });
    const ui = await Form16Page({ searchParams: Promise.resolve({ fy: "2025-26" }) });
    renderPage(ui);
    fireEventClickSummary();
    expect(screen.getByText(/unrecognized format/)).toBeInTheDocument();
    expect(screen.queryByText(/somethingElse/)).not.toBeInTheDocument();
  });
});

function fireEventClickSummary() {
  // Anchored so it only matches the `<summary>` ("Failure details (1)"),
  // never the unrecognized-shape fallback paragraph, which also starts with
  // the words "Failure details" (both are in the DOM at once, the
  // paragraph just inside the still-closed <details>).
  fireEvent.click(screen.getByText(/^Failure details \(/));
}
