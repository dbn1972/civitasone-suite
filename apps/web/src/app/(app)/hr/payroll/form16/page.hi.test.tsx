import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import hiMessages from "@/messages/hi.json";

// GAP-PAYROLL-FORM16-08: in the Hindi locale the back link is translated. The
// global next-intl/server mock is English-only, so this file swaps in a Hindi one.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const hi = (await import("@/messages/hi.json")).default;
  return {
    getTranslations: async (arg?: string | { namespace?: string }) => {
      const namespace = typeof arg === "string" ? arg : arg?.namespace;
      return createTranslator({ locale: "hi", messages: hi, namespace } as Parameters<typeof createTranslator>[0]);
    },
    getLocale: async () => "hi",
    getMessages: async () => hi,
  };
});
const { getSessionRolesMock, statusAwareGetMock } = vi.hoisted(() => ({
  getSessionRolesMock: vi.fn(() => ["employee"]),
  statusAwareGetMock: vi.fn(),
}));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: getSessionRolesMock }));
vi.mock("../_lib/statusAwareFetch", () => ({ statusAwareGet: statusAwareGetMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import Form16Page from "./page";

describe("Form16Page — Hindi locale (GAP-PAYROLL-FORM16-08)", () => {
  beforeEach(() => {
    statusAwareGetMock.mockReset();
    getSessionRolesMock.mockReturnValue(["employee"]);
  });

  it("shows the translated back label in the header and on the permission-denied card, not the English one", async () => {
    const ui = await Form16Page({ searchParams: Promise.resolve({}) });
    render(<NextIntlClientProvider locale="hi" messages={hiMessages}>{ui}</NextIntlClientProvider>);
    const links = screen.getAllByRole("link", { name: /पेरोल पर वापस जाएं/ });
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Back to Payroll")).not.toBeInTheDocument();
    for (const l of links) expect(l).toHaveAttribute("href", "/hr/payroll");
  });

  // GAP-PAYROLL-FORM16-05: failure reasons are translated from stable codes, so
  // a Hindi-locale admin reads Hindi copy, never backend (English) exception text.
  it("shows the failure reasons in Hindi and never the raw backend text", async () => {
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
    statusAwareGetMock.mockResolvedValue({
      kind: "ok", status: 200,
      body: { data: {
        jobId: "job-hi", fy: "2025-26", status: "completed", totalEmployees: 2, generated: 0, failed: 2,
        storagePrefix: "form16/2025-26",
        errorDetails: [
          { employeeNo: "EMP-0109", reasonCode: "STORAGE_ERROR", error: "S3 AccessDenied" },
          { employeeNo: "EMP-0110", reasonCode: "SIGNING_FAILED" },
        ],
        errorDetailsTotal: 2,
        createdAt: "2026-04-01T00:00:00.000Z", completedAt: null,
      } },
    });
    const ui = await Form16Page({ searchParams: Promise.resolve({ fy: "2025-26" }) });
    const { container } = render(<NextIntlClientProvider locale="hi" messages={hiMessages}>{ui}</NextIntlClientProvider>);
    fireEvent.click(screen.getByText(/^विफलता विवरण \(/));
    expect(screen.getByText("EMP-0109: PDF को भंडारण में सहेजा नहीं जा सका।")).toBeInTheDocument();
    expect(screen.getByText("EMP-0110: PDF पर डिजिटल हस्ताक्षर नहीं किए जा सके।")).toBeInTheDocument();
    expect(container.textContent).not.toContain("AccessDenied");
  });
});
