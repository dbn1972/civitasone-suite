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
    const ui = await Form16Page({ searchParams: {} });
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

    const ui = await Form16Page({ searchParams: { fy: "2025-26" } });
    renderPage(ui);

    expect(screen.getByText("job-1")).toBeInTheDocument();
    expect(screen.getByText("Total Employees")).toBeInTheDocument();
  });

  it("renders a legitimate empty state on a 404 (no job created yet)", async () => {
    statusAwareGetMock.mockResolvedValue({ kind: "http_error", status: 404, body: { code: "NOT_FOUND" } });

    const ui = await Form16Page({ searchParams: { fy: "2025-26" } });
    renderPage(ui);

    expect(screen.getByText("No Form-16 filing run for FY 2025-26")).toBeInTheDocument();
  });

  it("renders the error affordance (not the empty-state copy) on a real failure like 403", async () => {
    statusAwareGetMock.mockResolvedValue({ kind: "http_error", status: 403, body: { code: "FORBIDDEN" } });

    const ui = await Form16Page({ searchParams: { fy: "2025-26" } });
    renderPage(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    expect(screen.getByText("Could not load the Form-16 filing run for FY 2025-26")).toBeInTheDocument();
    expect(screen.queryByText("No Form-16 filing run for FY 2025-26")).not.toBeInTheDocument();
  });

  // GAP-PAYROLL-FORM16-05: a parseable errorDetails shape renders a safe
  // per-employee list, never the raw backend JSON blob.
  it("renders failure details as a parsed list, not raw JSON", async () => {
    statusAwareGetMock.mockResolvedValue({
      kind: "ok",
      status: 200,
      body: {
        data: {
          jobId: "job-2", fy: "2025-26", status: "completed",
          totalEmployees: 2, generated: 1, failed: 1,
          storagePrefix: "form16/2025-26",
          errorDetails: [{ employeeId: "e9", message: "No PAN on file" }],
          createdAt: "2026-04-01T00:00:00.000Z", completedAt: null,
        },
      },
    });
    const ui = await Form16Page({ searchParams: { fy: "2025-26" } });
    renderPage(ui);
    fireEventClickSummary();
    expect(screen.getByText("e9: No PAN on file")).toBeInTheDocument();
    expect(screen.queryByText(/"employeeId"/)).not.toBeInTheDocument();
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
    const ui = await Form16Page({ searchParams: { fy: "2025-26" } });
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
