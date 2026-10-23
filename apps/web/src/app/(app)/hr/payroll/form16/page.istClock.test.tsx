import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// CLOS2-S2-02: default FY follows the IST calendar, not the host clock.
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["payroll_admin"] }));
const statusAwareGetMock = vi.fn();
vi.mock("../_lib/statusAwareFetch", () => ({
  statusAwareGet: (...args: unknown[]) => statusAwareGetMock(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import Form16Page from "./page";

describe("Form16Page default FY (IST)", () => {
  beforeEach(() => {
    statusAwareGetMock.mockReset();
    statusAwareGetMock.mockResolvedValue({ kind: "http_error", status: 404, body: {} });
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => vi.useRealTimers());

  it("01:00 IST on 1 Apr 2026 defaults to 2026-27", async () => {
    vi.setSystemTime(new Date("2026-03-31T19:30:00Z"));
    await Form16Page({ searchParams: {} });
    expect(String(statusAwareGetMock.mock.calls[0]?.[0])).toContain("fy=2026-27");
  });

  it("23:30 IST on 31 Mar 2026 still defaults to 2025-26", async () => {
    vi.setSystemTime(new Date("2026-03-31T18:00:00Z"));
    await Form16Page({ searchParams: {} });
    expect(String(statusAwareGetMock.mock.calls[0]?.[0])).toContain("fy=2025-26");
  });
});
