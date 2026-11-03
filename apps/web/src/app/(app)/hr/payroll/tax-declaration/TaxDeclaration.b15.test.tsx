/**
 * UAT b15 item 3: /hr/payroll/tax-declaration for the super_admin persona (no employee record, no `employee` role).
 *
 * Root cause: the self-service loaders probed the API to find out who the caller is. GET
 * /v1/payroll/tax-declarations?fy= without employeeId is, by the route contract (payroll-service tax/routes.ts,
 * scopeEmployeeId), a 400 for payroll/HR staff, who must name the employee they file for; GET
 * /v1/payroll/tax-proofs/mine is employee-role only and is a 403 for anyone else. The screen read both refusals as
 * "who you are", after two failed requests on every load (and, before bundle 14, as a failed load with an overwrite
 * warning). The route contract is right; the loader was wrong. The page now knows the session roles, starts staff in
 * the on-behalf mode without the probe, and does not ask for "my proofs" for a user without the employee role. A user
 * with the employee role but no linked record still gets the NO_EMPLOYEE_RECORD state (bundle 14 code), now in the
 * proofs panel too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const browserFetch = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({
  browserFetch: (...a: unknown[]) => browserFetch(...a),
  errorMessageFromResponse: async () => "generic failure",
  errorCodeFromResponse: async (res: Response) => {
    try { return ((await res.clone().json()) as { code?: string }).code ?? null; } catch { return null; }
  },
}));
vi.mock("../../../../_components/EmployeePicker", () => ({
  EmployeePicker: ({ id }: { id?: string }) => <input id={id} aria-label="Employee" />,
}));

import { TaxDeclarationForm } from "./TaxDeclarationForm";
import { TaxProofsPanel } from "./TaxProofsPanel";
import { TAX_DECLARATION_STAFF_ROLES, isTaxDeclarationStaff, isSelfServiceEmployee } from "@/lib/payroll/taxDeclarationRoles";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const wrap = (ui: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

beforeEach(() => browserFetch.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("tax declaration: no probing requests for staff or non-employees (UAT b15 item 3)", () => {
  it("staff: the form opens in on-behalf mode and never sends the self-service GET without employeeId", async () => {
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("/limits") || u.includes("/window")) return Promise.resolve(json({}));
      return Promise.resolve(json({ code: "VALIDATION_FAILED" }, 400));
    });
    vi.stubGlobal("fetch", fetchMock);
    wrap(<TaxDeclarationForm staff />);
    expect(await screen.findByText(/filing on behalf of an employee/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const declarationCalls = fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => /\/tax-declarations\?/.test(u));
    expect(declarationCalls).toEqual([]);
  });

  it("a caller without the employee role: the proofs panel explains, and does not call tax-proofs/mine", async () => {
    wrap(<TaxProofsPanel fy="2026-27" selfService={false} />);
    expect(await screen.findByText(/available to employees filing their own declaration/i)).toBeInTheDocument();
    expect(browserFetch).not.toHaveBeenCalled();
  });

  it("an employee with no linked record: the proofs panel says so (NO_EMPLOYEE_RECORD), not an error", async () => {
    browserFetch.mockResolvedValueOnce(json({ code: "NO_EMPLOYEE_RECORD", message: "no employee record is linked to this user" }, 403));
    wrap(<TaxProofsPanel fy="2026-27" />);
    expect(await screen.findByText(/not linked to an employee record/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("the no-record copy exists in English and Hindi", () => {
    expect(enMessages.taxProofs.noEmployeeRecord).toBeTruthy();
    expect(hiMessages.taxProofs.noEmployeeRecord).toBeTruthy();
  });
});

describe("tax declaration roles mirror the payroll-service route contract", () => {
  it("staff roles = READER_ROLES of GET /v1/payroll/tax-declarations minus employee", () => {
    const src = readFileSync(join(process.cwd(), "../../services/payroll-service/src/modules/tax/routes.ts"), "utf8");
    const list = (name: string) => {
      const m = new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(src);
      if (!m) throw new Error(`${name} not found`);
      return m[1]!;
    };
    const payroll = [...list("PAYROLL_ROLES").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!);
    const reader = [...payroll, ...[...list("READER_ROLES").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!)];
    const staff = [...new Set(reader.filter((r) => r !== "employee"))].sort();
    expect([...TAX_DECLARATION_STAFF_ROLES].sort()).toEqual(staff);
  });

  it("super_admin is staff, not a self-service employee; an employee is not staff", () => {
    expect(isTaxDeclarationStaff(["super_admin"])).toBe(true);
    expect(isSelfServiceEmployee(["super_admin"])).toBe(false);
    expect(isTaxDeclarationStaff(["employee"])).toBe(false);
    expect(isSelfServiceEmployee(["employee"])).toBe(true);
  });

  it("the page passes the session roles to both loaders", () => {
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(page).toMatch(/<TaxDeclarationForm staff=\{/);
    expect(page).toMatch(/<TaxProofsPanel[^>]*selfService=\{/);
  });
});
