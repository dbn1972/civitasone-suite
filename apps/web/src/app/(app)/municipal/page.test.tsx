import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "./page";
import { MUNICIPAL_SERVICE_CATALOG, SEC5_SERVICE_COUNT } from "./_data/services";

describe("Municipal hub page", () => {
  it("renders a card for every catalog service", () => {
    render(<Page />);
    for (const svc of MUNICIPAL_SERVICE_CATALOG) {
      expect(screen.getByRole("heading", { name: svc.label })).toBeInTheDocument();
    }
  });

  it("shows the Sec5 service count in the subtitle and stat card", () => {
    render(<Page />);
    expect(screen.getByText(new RegExp(`${SEC5_SERVICE_COUNT} Sec5 services`))).toBeInTheDocument();
  });

  it("only shows a Citizen portal quick link for services with a citizen-service manifest", () => {
    render(<Page />);
    // trade has a real manifest (trade-license) — link present.
    expect(screen.getByRole("link", { name: "Trade Licence" })).toBeInTheDocument();
    const tradeItem = screen.getByRole("link", { name: "Trade Licence" }).closest("li");
    expect(tradeItem?.querySelector('a[href^="/citizen/services/"]')).not.toBeNull();
  });
});
