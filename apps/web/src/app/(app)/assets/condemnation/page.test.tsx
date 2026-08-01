import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import CondemnationPage from "./page";

describe("CondemnationPage", () => {
  it("renders the page heading and all three workflow panels", () => {
    render(<CondemnationPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Condemnation, Auction & Disposal" })).toBeInTheDocument();
    expect(screen.getByText("1. Condemnation survey")).toBeInTheDocument();
    expect(screen.getByText("2. Committee recommendation (maker-checker)")).toBeInTheDocument();
    expect(screen.getByText("3. Auction")).toBeInTheDocument();
  });
});
