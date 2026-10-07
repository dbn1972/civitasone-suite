import { describe, it, expect, vi, beforeEach } from "vitest";
import { redirect } from "next/navigation";

// GAP-ANALYTICS-LIST-02 (UX-COPY): the finding was that ModuleListTable prints
// a raw/truncated record id in an ID column — an internal identifier with no
// meaning to a clerk — and that column was reachable from /analytics/list.
// Two things resolve it now, both on main:
//   1. /analytics/list redirects to the canonical /analytics/dashboards
//      (LIST-01), so the generic ModuleListTable (and its ID column) is no
//      longer reachable from analytics at all. This test pins that redirect.
//   2. The shared ModuleListTable itself now shows slug/code ids in FULL and
//      only shortens a bare UUID, keeping the full id in a `title` for
//      copy/disambiguation (GAP-ADMIN-GATEWAY-ROUTES-02) — covered by the
//      shared ModuleListTable.test.tsx. Removing the column outright is a
//      cross-module decision out of scope for the analytics route.
// This test fails on the old code where /analytics/list rendered its own
// generic ModuleListPage/ModuleListTable instead of redirecting.
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import Page from "./page";

const mockedRedirect = vi.mocked(redirect);

describe("Analytics list route (GAP-ANALYTICS-LIST-02)", () => {
  beforeEach(() => {
    mockedRedirect.mockReset();
  });

  it("redirects to the canonical Dashboards page instead of rendering the raw-id ModuleListTable", () => {
    Page();
    expect(mockedRedirect).toHaveBeenCalledWith("/analytics/dashboards");
  });
});
