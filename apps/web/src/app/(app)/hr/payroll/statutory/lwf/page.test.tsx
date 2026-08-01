import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import LwfPage from "./page";

describe("LwfPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders LWF configuration", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { lwfConfig: [{ state_code: "KA", employee_contrib_minor: 2000, employer_contrib_minor: 2000, frequency: "yearly" }] },
      source: "api",
    });
    const ui = await LwfPage();
    render(ui);
    expect(screen.getByText("KA")).toBeInTheDocument();
  });

  it("renders an empty state when there is no LWF configuration", async () => {
    fetchJsonMock.mockResolvedValue({ data: { lwfConfig: [] }, source: "api" });
    const ui = await LwfPage();
    render(ui);
    expect(screen.getByText("No LWF configuration")).toBeInTheDocument();
  });
});
