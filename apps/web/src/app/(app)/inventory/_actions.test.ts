import { describe, it, expect, vi, beforeEach } from "vitest";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
const auth = vi.hoisted(() => ({ getSessionRoles: vi.fn<() => string[]>(() => []) }));
vi.mock("@/lib/auth/roleGuard", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/roleGuard")>()),
  ...auth,
}));

import { revalidateInventoryViews } from "./_actions";

beforeEach(() => vi.clearAllMocks());

describe("CLOS3-S2-02 revalidateInventoryViews", () => {
  it.each(["inventory_user", "store_keeper", "inventory_manager", "inventory_admin", "super_admin"])(
    "%s purges the whole /inventory tree",
    async (role) => {
      auth.getSessionRoles.mockReturnValue([role]);
      await revalidateInventoryViews();
      expect(revalidatePath).toHaveBeenCalledWith("/inventory", "layout");
    },
  );

  it("a role without inventory access is a silent no-op", async () => {
    auth.getSessionRoles.mockReturnValue(["employee", "crm_user"]);
    await revalidateInventoryViews();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
