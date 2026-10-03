import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null }),
}));

import { VendorsTable } from "./VendorsTable";

describe("VendorsTable (GAP-FINANCE-VENDORS-04)", () => {
  it("shows Unregistered for a vendor without a GSTIN and the GSTIN otherwise", () => {
    render(
      <VendorsTable
        vendors={[
          { id: "v1", name: "Acme", category: "Goods", pan: "ABCDE****F", gstin: null, status: "active", ratingDisplay: "x" },
          { id: "v2", name: "Beta", category: "Goods", pan: "ABCDE****G", gstin: "29ABCDE1234F1Z5", status: "active", ratingDisplay: "x" },
        ] as never}
      />,
    );
    expect(screen.getByText("Unregistered")).toBeInTheDocument();
    expect(screen.getByText("29ABCDE1234F1Z5")).toBeInTheDocument();
  });
});
