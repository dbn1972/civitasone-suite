import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Loading from "./loading";

describe("Onboarding list Loading", () => {
  it("renders a busy, labelled skeleton instead of a bare unrelated placeholder", () => {
    render(<Loading />);
    const region = screen.getByLabelText("Loading onboarding tracker");
    expect(region).toHaveAttribute("aria-busy", "true");
  });
});
