/**
 * PR #2450 review (should-fix 1): the page gated the proofs panel on `employee && !staff`, which hid own-proof listing
 * and upload from a staff member who is also an employee (hr_admin + employee). GET /v1/payroll/tax-proofs/mine needs
 * only the employee role, so the panel follows that role alone; the declaration form still opens in on-behalf mode
 * for staff.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const roles = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles.current }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("./TaxDeclarationForm", () => ({
  TaxDeclarationForm: ({ staff }: { staff?: boolean }) => <div data-testid="form">{`staff=${String(staff)}`}</div>,
}));
vi.mock("./TaxProofsPanel", () => ({
  TaxProofsPanel: ({ selfService }: { selfService?: boolean }) => <div data-testid="proofs">{`selfService=${String(selfService)}`}</div>,
}));

import TaxDeclarationPage from "./page";

async function renderAs(r: string[]) {
  roles.current = r;
  render(await TaxDeclarationPage());
}

describe("tax declaration page: mode from the session roles", () => {
  it("staff + employee (hr_admin + employee): on-behalf form AND own proofs", async () => {
    await renderAs(["hr_admin", "employee"]);
    expect(screen.getByTestId("form")).toHaveTextContent("staff=true");
    expect(screen.getByTestId("proofs")).toHaveTextContent("selfService=true");
  });

  it("super_admin without the employee role: on-behalf form, no own-proof listing", async () => {
    await renderAs(["super_admin"]);
    expect(screen.getByTestId("form")).toHaveTextContent("staff=true");
    expect(screen.getByTestId("proofs")).toHaveTextContent("selfService=false");
  });

  it("an employee: self-service form and own proofs", async () => {
    await renderAs(["employee"]);
    expect(screen.getByTestId("form")).toHaveTextContent("staff=false");
    expect(screen.getByTestId("proofs")).toHaveTextContent("selfService=true");
  });
});
