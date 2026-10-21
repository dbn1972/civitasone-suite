import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import knMessages from "@/messages/kn.json";
import taMessages from "@/messages/ta.json";
import teMessages from "@/messages/te.json";


let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

import BulkImportPage from "./page";

async function renderPage() {
  const page = await BulkImportPage();
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{page}</NextIntlClientProvider>);
}

describe("BulkImportPage — role gating (Problem A)", () => {
  it("shows an honest permission-denied state for 'employee'", async () => {
    // Regression: ImportForm.tsx posts each row to POST /v1/hrms/employees,
    // which requires hr_admin/hr_officer/super_admin (employee/routes.ts).
    // Confirmed live for the sibling /hr/employees/new page.
    mockRoles = ["employee"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByText("Bulk Employee Import")).not.toBeInTheDocument();
  });

  it("renders the real bulk-import page for super_admin", async () => {
    mockRoles = ["super_admin"];
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    expect(screen.getByText("Bulk Employee Import")).toBeInTheDocument();
  });
});

/** GAP-HR-EMPLOYEES-IMPORT-07 */
describe("BulkImportPage — accessibility polish (IMPORT-07)", () => {
  it("scrolls the template table inside its own card at narrow widths instead of widening the page", async () => {
    mockRoles = ["super_admin"];
    await renderPage();
    const table = screen.getAllByRole("table")[0] as HTMLElement;
    const wrapper = table.parentElement as HTMLElement;
    expect(wrapper.style.overflowX).toBe("auto");
  });

  it("carries no emoji glyphs in the import copy of any locale (a screen reader reads them out as white heavy check mark)", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    const offenders: string[] = [];
    const locales: Record<string, Record<string, unknown>> = {
      en: enMessages, hi: hiMessages, kn: knMessages, ta: taMessages, te: teMessages,
    };
    for (const [loc, messages] of Object.entries(locales)) {
      for (const ns of ["employeeImport", "employeeImportForm"]) {
        const bucket = (messages[ns] ?? {}) as Record<string, unknown>;
        for (const [key, value] of Object.entries(bucket)) {
          if (typeof value === "string" && emoji.test(value)) offenders.push(`${loc}.${ns}.${key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
