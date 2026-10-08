/**
 * GAP2-CITIZEN-AUTHZ-ROLEGATE-01: discovery, intake and payments under
 * /citizen are officer/clerk tools whose backend surfaces are OFFICER_ROLES-
 * gated. Each page now calls requireAnyRole(CITIZEN_OFFICER_ROLES, "/citizen")
 * so a citizen-role user is redirected (PermissionDenied) rather than shown a
 * staff tool that 403s on every fetch. The server stays authoritative; this
 * asserts the web gate exists and targets the roles that mirror the server.
 *
 * On the OLD code none of these pages called requireAnyRole at all, so every
 * assertion here fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAnyRole = vi.fn();
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return {
    ...actual,
    requireAnyRole: (...a: unknown[]) => requireAnyRole(...a),
    getSessionName: () => "Test Officer",
  };
});

// next-intl/server throws under plain Vitest; same minimal mock as the sibling
// citizen page tests.
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));

// Stub the data loaders + client panels so these stay focused on the gate.
vi.mock("../../../_data/citizenPartials", () => ({
  getCatalogueServices: async () => ({ data: [] }),
}));
vi.mock("../../../_data/citizenGaps", () => ({
  getFeeSchedules: async () => ({ data: [], status: "ok" }),
}));
vi.mock("../../../_data/useResource", () => ({
  toResourceState: () => ({ status: "ok" }),
}));
vi.mock("./DiscoveryPanel", () => ({ DiscoveryPanel: () => <div>discovery</div> }));
vi.mock("./IntakePanel", () => ({ IntakePanel: () => <div>intake</div> }));
vi.mock("./PaymentPanel", () => ({ PaymentPanel: () => <div>payments</div> }));

import DiscoveryPage from "./discovery/page";
import IntakePage from "./intake/page";
import PaymentsPage from "./payments/page";
import { CITIZEN_OFFICER_ROLES } from "@/lib/auth/roleGuard";

describe("Citizen officer-only page gates (GAP2-CITIZEN-AUTHZ-ROLEGATE-01)", () => {
  beforeEach(() => requireAnyRole.mockReset());

  it("discovery gates on CITIZEN_OFFICER_ROLES, redirecting to /citizen", async () => {
    await DiscoveryPage();
    expect(requireAnyRole).toHaveBeenCalledWith(CITIZEN_OFFICER_ROLES, "/citizen");
  });

  it("intake gates on CITIZEN_OFFICER_ROLES, redirecting to /citizen", async () => {
    await IntakePage();
    expect(requireAnyRole).toHaveBeenCalledWith(CITIZEN_OFFICER_ROLES, "/citizen");
  });

  it("payments gates on CITIZEN_OFFICER_ROLES, redirecting to /citizen", async () => {
    await PaymentsPage();
    expect(requireAnyRole).toHaveBeenCalledWith(CITIZEN_OFFICER_ROLES, "/citizen");
  });
});
