import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (k: string) => k,
}));

import { SelfServiceCard } from "./SelfServiceCard";

/** PR #2461 review SHOULD-FIX 2: the card follows tenant modules as the sidebar does. */
describe("SelfServiceCard", () => {
  it("lists the HR self-service links for an employee on an HRMS tenant", async () => {
    render(await SelfServiceCard({ roles: ["employee"], enabledModules: ["hrms-leave", "hrms-payroll", "hrms-attendance"] }));
    expect(screen.getAllByRole("link").length).toBeGreaterThan(0);
  });

  it("offers no ModuleGate-blocked link on a standalone tenant with no hrms-* keys", async () => {
    const out = await SelfServiceCard({ roles: ["employee"], enabledModules: ["smart-transfer"] });
    expect(out).toBeNull();
  });

  it("keeps showing links when the module list is unknown (null)", async () => {
    render(await SelfServiceCard({ roles: ["employee"], enabledModules: null }));
    expect(screen.getAllByRole("link").length).toBeGreaterThan(0);
  });
});
