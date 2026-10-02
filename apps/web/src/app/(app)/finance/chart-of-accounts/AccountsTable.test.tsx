import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";

const mockedHook = vi.mocked(useSeededResource);
function seed(data: unknown, provenance: "live" | "cached" | "error-no-data") {
  mockedHook.mockReturnValue({
    data: data as never, fromCache: provenance === "cached", offline: false,
    cachedAt: provenance === "cached" ? "2026-09-01T00:00:00.000Z" : null, provenance,
  } as never);
}
import { AccountsTable } from "./AccountsTable";

describe("AccountsTable (GAP-FINANCE-CHART-OF-ACCOUNTS-01)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("failed load with no cache shows retry and NO 'Add your first head' CTA", () => {
    seed([], "error-no-data");
    render(<AccountsTable accounts={[]} source="error" />);
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/No accounts set up yet/)).not.toBeInTheDocument();
    expect(screen.queryByText("+ Add Head")).not.toBeInTheDocument();
  });

  it("a genuinely empty live chart still shows the first-run CTA", () => {
    seed([], "live");
    render(<AccountsTable accounts={[]} source="api" />);
    expect(screen.getByText(/No accounts set up yet/)).toBeInTheDocument();
  });
});
