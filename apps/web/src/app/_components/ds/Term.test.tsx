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
});
