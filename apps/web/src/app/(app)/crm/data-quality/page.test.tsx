import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_components/crm/DataQualityView", () => ({
  DataQualityView: () => <div data-testid="dq-view" />,
}));

import Page from "./page";

describe("Data Quality page (GoI redesign)", () => {
  it("renders heading with Data Quality", () => {
    render(<Page />);
    expect(screen.getByText(/Data Quality/)).toBeInTheDocument();
  });

  it("renders the DataQualityView component", () => {
    render(<Page />);
    expect(screen.getByTestId("dq-view")).toBeInTheDocument();
  });

  it("renders GoI context note about RTI disclosures", () => {
    render(<Page />);
    const note = screen.getByRole("note");
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent(/RTI/i);
  });
});
