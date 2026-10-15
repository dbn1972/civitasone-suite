import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("./DataWarehouseTable", () => ({ DataWarehouseTable: () => <div /> }));

import DwLoading from "./loading";
import DataWarehousePage from "./page";

// GAP-ANALYTICS-DATA-WAREHOUSE-04 regressions (W2).
describe("data-warehouse empty state + loading", () => {
  it("empty state has no Run Query CTA", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await DataWarehousePage());
    expect(screen.getByText("No datasets")).toBeInTheDocument();
    expect(screen.queryByText(/run query/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /run query/i })).not.toBeInTheDocument();
  });

  it("loading renders the skeleton shape (stat cards + table rows)", () => {
    const { container } = render(<DwLoading />);
    expect(screen.getAllByText(/Loading/i).length).toBeGreaterThan(0);
    expect(container.querySelectorAll("[aria-hidden=true]").length).toBeGreaterThan(10);
  });
});
