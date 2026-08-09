import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CitizenServiceLinks } from "./CitizenServiceLinks";
import { getMunicipalService } from "../_data/catalog";

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
});
