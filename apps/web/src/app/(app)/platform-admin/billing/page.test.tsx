import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

const { requireAnyRole, getPending } = vi.hoisted(() => ({ requireAnyRole: vi.fn(), getPending: vi.fn() }));
vi.mock("@/lib/auth/roleGuard", () => ({ requireAnyRole }));
vi.mock("@/app/_data/loaders", () => ({ getPendingDowngradeRequests: getPending }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import PlatformBillingPage from "./page";

const row = {
  id: crypto.randomUUID(), tenantId: crypto.randomUUID(), fromPlanId: crypto.randomUUID(), targetPlanId: crypto.randomUUID(),
  reason: "Headcount drops after the restructuring", requestedAt: "2026-10-20T08:00:00Z",
};

describe("platform billing page (F8)", () => {
  beforeEach(() => { requireAnyRole.mockReset(); getPending.mockReset(); });

  it("admits exactly the roles tenant-service lets decide (not tenant_admin)", async () => {
    getPending.mockResolvedValue({ data: [], source: "api" });
    await PlatformBillingPage();
    expect(requireAnyRole).toHaveBeenCalledWith(["platform_admin", "super_admin"], "/dashboard");
  });

  it("shows the queue when there are pending requests", async () => {
    getPending.mockResolvedValue({ data: [row], source: "api" });
    render(await PlatformBillingPage());
    expect(screen.getByText(row.reason)).toBeTruthy();
  });

  it("an empty queue and a failed load look different", async () => {
    getPending.mockResolvedValue({ data: [], source: "api" });
    const { unmount } = render(await PlatformBillingPage());
    expect(screen.getByText("No downgrade requests are waiting.")).toBeTruthy();
    unmount();
    getPending.mockResolvedValue({ data: [], source: "error" });
    render(await PlatformBillingPage());
    expect(screen.queryByText("No downgrade requests are waiting.")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
