import { describe, it, expect, vi } from "vitest";

// GAP-CONTRACTS-HOME-02: /procurement/contracts now permanently redirects to
// the canonical /contracts/list. This replaces the former render suite (which
// was testing the now-removed procurement-contracts content) with a single
// test that verifies the redirect target.
const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import ProcurementContractsPage from "./page";

describe("ProcurementContractsPage (GAP-CONTRACTS-HOME-02 redirect)", () => {
  it("GAP-CONTRACTS-HOME-02: redirects to the canonical /contracts/list", () => {
    redirectMock.mockImplementation(() => {
      // next/navigation redirect() throws a NEXT_REDIRECT in RSC context;
      // in tests the mock just returns — we verify the call target.
    });
    ProcurementContractsPage();
    expect(redirectMock).toHaveBeenCalledWith("/contracts/list");
  });
});
