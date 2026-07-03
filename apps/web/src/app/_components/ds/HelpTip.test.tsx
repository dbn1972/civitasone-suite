import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelpTip } from "./HelpTip";

describe("HelpTip", () => {
  it("renders trigger button with ? character", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    expect(screen.getByRole("button")).toHaveTextContent("?");
  });

  it("has aria-label derived from term", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "What is GRN?");
  });

  it("has generic aria-label when no term", () => {
    render(<HelpTip>Some explanation</HelpTip>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "More information");
  });

  it("tooltip is not visible initially", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows tooltip on click", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Goods Received Note");
  });

  it("shows term name in bold within tooltip", () => {
    render(<HelpTip term="UC">Utilisation Certificate</HelpTip>);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("UC")).toBeInTheDocument();
  });

  it("shows tooltip on mouseEnter", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("hides tooltip on mouseLeave", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows tooltip on focus", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    fireEvent.focus(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("hides tooltip on blur", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    fireEvent.focus(screen.getByRole("button"));
    fireEvent.blur(screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("sets aria-expanded=true when open", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("sets aria-expanded=false when closed", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });
});
