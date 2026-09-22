import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Term } from "./Term";

// Mock the glossary module
vi.mock("@/lib/glossary", () => ({
  explain: (name: string) => {
    const glossary: Record<string, string> = {
      GRN: "A document confirming goods have been received at the store.",
      UC: "A certificate proving the grant money was used for its intended purpose.",
      DDO: "The Drawing and Disbursing Officer who authorises payments.",
    };
    return glossary[name] ?? null;
  },
}));

describe("Term", () => {
  it("renders term name with HelpTip when glossary entry exists", () => {
    render(<Term name="GRN" />);
    expect(screen.getByText("GRN")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("renders custom label when provided", () => {
    render(<Term name="GRN" label="Goods Received Note" />);
    expect(screen.getByText("Goods Received Note")).toBeInTheDocument();
  });

  it("renders plain text without HelpTip when no glossary entry", () => {
    render(<Term name="UnknownTerm" />);
    expect(screen.getByText("UnknownTerm")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders plain text with custom label when no glossary entry", () => {
    render(<Term name="Unknown" label="Custom Label" />);
    expect(screen.getByText("Custom Label")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows tooltip content from glossary on focus", () => {
    render(<Term name="UC" />);
    const btn = screen.getByRole("button");
    fireEvent.focus(btn);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "A certificate proving the grant money was used for its intended purpose.",
    );
  });

  // Issue #21: every call site used to splice raw punctuation directly
  // around <Term> in its own JSX (e.g. "(<Term name=\"LMMHA\" />)"). That
  // punctuation was an ordinary sibling text node with no relationship to
  // the icon, so it could render flush against the icon's edge with zero
  // gap, or get stranded alone at the start of the next line on wrap. These
  // before/after props move that punctuation inside Term's own
  // `white-space: nowrap` wrapper so it always stays visually attached to
  // the word and its icon.
  it("keeps before/after punctuation, the word, and its icon together as one non-breaking unit", () => {
    render(<Term name="GRN" before="(" after=")" />);
    // The wrapper's own direct text content is "(GRN)" -- "(" and ")"
    // (before/after) plus "GRN" (text), with the icon rendered as a nested
    // element in between (excluded from this element's own direct text).
    const wrapper = screen.getByText("(GRN)");
    expect(wrapper.style.whiteSpace).toBe("nowrap");
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("still renders before/after text when the term has no glossary definition", () => {
    const { container } = render(<Term name="UnknownTerm" before="(" after=")" />);
    expect(container.textContent).toBe("(UnknownTerm)");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
