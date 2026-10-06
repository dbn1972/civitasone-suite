import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CitizenServiceLinks } from "./CitizenServiceLinks";
import { getMunicipalService } from "../_data/services";

describe("CitizenServiceLinks", () => {
  it("renders apply and service page links for trade", () => {
    const config = getMunicipalService("trade")!;
    render(<CitizenServiceLinks config={config} />);
    expect(screen.getByRole("link", { name: /Apply online/i })).toHaveAttribute(
      "href",
      "/citizen/services/trade-license/apply",
    );
    expect(screen.getByRole("link", { name: /Service page/i })).toHaveAttribute(
      "href",
      "/citizen/services/trade-license",
    );
  });

  it("appends counter query for CSC mode", () => {
    const config = getMunicipalService("fire")!;
    render(<CitizenServiceLinks config={config} counterMode />);
    expect(screen.getByRole("link", { name: /Apply online/i })).toHaveAttribute(
      "href",
      "/citizen/services/fire-noc/apply?counter=1",
    );
  });

  it("shows a counter-only note (no links) for a service with no citizen-service manifest (SERVICEKEY-04)", () => {
    // GAP-MUNICIPAL-SERVICEKEY-04 deliberately changed this from rendering
    // nothing to rendering an explanatory note, so officers understand how
    // citizens apply for counter-only services.
    const config = getMunicipalService("building")!;
    render(<CitizenServiceLinks config={config} />);
    expect(screen.getByText(/recorded by officers at the counter/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Apply online/i })).not.toBeInTheDocument();
  });
});
