import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const render = (ui: ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import DeputationPage from "./page";

const ACTIVE = { id: "dep-1", employee: "Asha Rao", parentOrg: "Finance", deputationOrg: "Ministry of Finance", fromDate: "2026-01-01", toDate: "2099-01-01", status: "active" };

describe("DeputationPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ data: [ACTIVE], source: "api" });
    mockRoles = [];
  });

  // GAP-HR-DEPUTATION-02: mirrors deputation/routes.ts HR_ROLES (hr_admin, hr_officer, super_admin).
  it.each(["hr_admin", "hr_officer", "super_admin"])("%s sees Repatriate and Cancel on an active deputation", async (role) => {
    mockRoles = [role];
    render(await DeputationPage());
    expect(screen.getByRole("button", { name: "Repatriate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it.each(["manager", "employee", "payroll_admin"])("%s sees no action buttons", async (role) => {
    mockRoles = [role];
    render(await DeputationPage());
    expect(screen.getAllByText("Asha Rao").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Repatriate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  // GAP-HR-DEPUTATION-06: the back link is a message key now, not a literal.
  it("takes the back-link label from the deputation namespace", async () => {
    render(await DeputationPage());
    expect(screen.getByText(enMessages.deputation.backLabel)).toBeInTheDocument();
    const code = readFileSync(join(process.cwd(), "src/app/(app)/hr/deputation/page.tsx"), "utf8");
    expect(code).not.toContain('backLabel="Back to HR"');
    expect(code).toContain('backLabel={t("backLabel")}');
  });

  it("hi has the whole deputation namespace (page + card), same keys as en", () => {
    const flat = (o: Record<string, unknown>, pre = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [pre + k] : flat(v as Record<string, unknown>, `${pre}${k}.`)));
    expect(flat((hiMessages as unknown as { deputation: Record<string, unknown> }).deputation).sort()).toEqual(flat(enMessages.deputation).sort());
  });
});
