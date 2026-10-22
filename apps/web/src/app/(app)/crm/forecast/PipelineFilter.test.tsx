import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { PipelineFilter } from "./PipelineFilter";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// GAP-CRM-FORECAST-02: a failed pipelines fetch must not silently remove the filter.
describe("PipelineFilter (GAP-CRM-FORECAST-02)", () => {
  it("shows a disabled control that says the pipelines could not be loaded when the fetch failed", () => {
    renderWithIntl(<PipelineFilter pipelines={[]} pipelinesFailed />);
    const select = screen.getByRole("combobox");
    expect(select).toBeDisabled();
    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  it("offers the pipelines as an enabled filter when they loaded", () => {
    renderWithIntl(<PipelineFilter pipelines={[{ id: "p1", name: "Enterprise" }]} />);
    const select = screen.getByRole("combobox");
    expect(select).not.toBeDisabled();
    expect(screen.getByRole("option", { name: "Enterprise" })).toBeInTheDocument();
  });
});
