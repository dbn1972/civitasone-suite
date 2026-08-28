import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import EstabFileDetailPage from "./page";

describe("EstabFileDetailPage — not-found vs error (L3)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("shows a retryable load error (NOT a false 'File not found') when the fetch fails", async () => {
    // 404, 5xx and network all collapse to source:"error" — never claim the
    // file was lost during a backend blip.
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });

    const ui = await EstabFileDetailPage({ params: { id: "f1" } });
    render(ui);

    expect(screen.queryByText("File not found")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
