import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ProfessionalTaxPage from "./page";

describe("ProfessionalTaxPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders PT slabs", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ state_code: "KA", slab_from_minor: 0, slab_to_minor: 1500000, pt_amount_minor: 0 }],
      source: "api",
    });
    const ui = await ProfessionalTaxPage();
    render(ui);
    expect(screen.getByText("KA")).toBeInTheDocument();
  });

  it("renders an empty state when there are no PT slabs", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await ProfessionalTaxPage();
    render(ui);
    expect(screen.getByText("No PT slabs configured")).toBeInTheDocument();
  });
});
