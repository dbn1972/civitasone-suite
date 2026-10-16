import { describe, it, expect, vi } from "vitest";

// GAP-CONTRACTS-HOME-02: /procurement/contracts now permanently redirects to
// the canonical /contracts/list. This replaces the former render suite (which
// was testing the now-removed procurement-contracts content) with a single
// test that verifies the redirect target.
//
// Use the module-factory form of vi.mock so the mock is in scope at hoist time;
// then import the mock function through the already-mocked module rather than
// via a top-level const (which would be uninitialized when the factory runs).
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import ProcurementContractsPage from "./page";

describe("ProcurementContractsPage (GAP-CONTRACTS-HOME-02 redirect)", () => {
  it("GAP-CONTRACTS-HOME-02: redirects to the canonical /contracts/list", () => {
    ProcurementContractsPage();
    expect(redirect).toHaveBeenCalledWith("/contracts/list");
  });
});
