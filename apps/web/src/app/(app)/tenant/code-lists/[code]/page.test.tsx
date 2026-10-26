import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { loader } = vi.hoisted(() => ({ loader: vi.fn() }));
vi.mock("../../_data", () => ({ getTenantCodeListValues: loader }));

import Page from "./page";

// GAP-TENANT-CODE-LISTS-01: a code list drills down to its effective-dated values.
describe("tenant code-list values page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the values for the code in the URL and shows them with effective dates", async () => {
    loader.mockResolvedValue({
      data: [{ id: "v1", label: "Urban", sublabel: "URBAN", status: "Active", meta: "From 1 Jan 2026" }],
      source: "api",
    });
    render(await Page({ params: Promise.resolve({ code: "ward_type" }) }));
    expect(loader).toHaveBeenCalledWith("ward_type");
    expect(screen.getByRole("heading", { name: /ward_type/ })).toBeInTheDocument();
    expect(screen.getByText("Urban")).toBeInTheDocument();
    expect(screen.getByText("From 1 Jan 2026")).toBeInTheDocument();
  });

  it("an unknown list (404) is a not-found, not an empty table", async () => {
    loader.mockResolvedValue({ data: [], source: "error", status: 404 });
    await expect(Page({ params: Promise.resolve({ code: "nope" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
