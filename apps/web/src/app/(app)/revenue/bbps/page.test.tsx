import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BbpsPage from "./page";

describe("BbpsPage", () => {
  it("renders the fetch-bill and pay-bill forms", () => {
    render(<BbpsPage />);
    expect(screen.getByText("BBPS Bill Fetch & Pay")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Fetch BBPS bill" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Pay BBPS bill" })).toBeInTheDocument();
  });
});
