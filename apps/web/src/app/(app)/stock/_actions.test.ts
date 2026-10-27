import { describe, it, expect, vi, beforeEach } from "vitest";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
const auth = vi.hoisted(() => ({ getSessionRoles: vi.fn<() => string[]>(() => []) }));
vi.mock("@/lib/auth/roleGuard", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/roleGuard")>()),
  ...auth,
}));

import { revalidateStockViews } from "./_actions";

beforeEach(() => vi.clearAllMocks());

describe("GAP-STOCK-ITEMS-NEW-01 revalidateStockViews", () => {
  it.each(["stock_manager", "stock_admin", "procurement_officer", "super_admin"])(
    "%s purges the whole /stock tree",
    async (role) => {
      auth.getSessionRoles.mockReturnValue([role]);
      await revalidateStockViews();
      expect(revalidatePath).toHaveBeenCalledWith("/stock", "layout");
    },
  );

  it("a role without stock write access is a silent no-op", async () => {
    auth.getSessionRoles.mockReturnValue(["employee", "audit_officer"]);
    await revalidateStockViews();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
