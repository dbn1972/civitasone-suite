import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GlossaryList } from "./GlossaryList";
import { collapseGlossary } from "@/lib/glossary";

function searchBox() {
  return screen.getByRole("searchbox", { name: /search words/i });
}

describe("GlossaryList (GAP-HELP-HOME-02)", () => {
  it("typing 'voucher' shows only the Voucher entry; clearing restores all", () => {
    render(<GlossaryList rows={collapseGlossary()} />);

    expect(screen.getByText("Voucher")).toBeInTheDocument();
    expect(screen.getByText("RFQ")).toBeInTheDocument();

    fireEvent.change(searchBox(), { target: { value: "voucher" } });
    expect(screen.getByText("Voucher")).toBeInTheDocument();
    expect(screen.queryByText("RFQ")).not.toBeInTheDocument();

    fireEvent.change(searchBox(), { target: { value: "" } });
    expect(screen.getByText("RFQ")).toBeInTheDocument();
  });

  it("HoA and Head of Account render as one row 'Head of Account (HoA)'", () => {
    render(<GlossaryList rows={collapseGlossary()} />);
    const terms = screen.getAllByRole("term").map((n) => n.textContent);
    expect(terms).toContain("Head of Account (HoA)");
    expect(terms).not.toContain("HoA");
    expect(terms.filter((t) => t === "Head of Account").length).toBe(0);
  });

  it("shows 'No words match' when the filter has no hits", () => {
    render(<GlossaryList rows={collapseGlossary()} />);
    fireEvent.change(searchBox(), { target: { value: "zzzznomatch" } });
    expect(screen.getByText("No words match")).toBeInTheDocument();
  });

  it("searching an alias finds its canonical row", () => {
    render(<GlossaryList rows={collapseGlossary()} />);
    fireEvent.change(searchBox(), { target: { value: "HoA" } });
    expect(screen.getByText("Head of Account (HoA)")).toBeInTheDocument();
  });
});
