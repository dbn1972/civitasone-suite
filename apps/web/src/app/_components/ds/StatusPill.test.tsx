import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it("renders the status text", () => {
    render(<StatusPill status="active" />);
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("renders custom label when provided", () => {
    render(<StatusPill status="active" label="Approved" />);
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.queryByText("active")).not.toBeInTheDocument();
  });

  it("applies 'good' variant for approved status", () => {
    const { container } = render(<StatusPill status="approved" />);
    expect(container.querySelector(".pill.good")).toBeInTheDocument();
  });

  it("applies 'warn' variant for pending status", () => {
    const { container } = render(<StatusPill status="pending" />);
    expect(container.querySelector(".pill.warn")).toBeInTheDocument();
  });

  it("applies 'bad' variant for rejected status", () => {
    const { container } = render(<StatusPill status="rejected" />);
    expect(container.querySelector(".pill.bad")).toBeInTheDocument();
  });

  it("applies 'mut' variant for draft status", () => {
    const { container } = render(<StatusPill status="draft" />);
    expect(container.querySelector(".pill.mut")).toBeInTheDocument();
  });

  it("applies 'info' variant for unknown status", () => {
    const { container } = render(<StatusPill status="unknown_status" />);
    expect(container.querySelector(".pill.info")).toBeInTheDocument();
  });

  it("handles case-insensitive status lookup", () => {
    const { container } = render(<StatusPill status="APPROVED" />);
    expect(container.querySelector(".pill.good")).toBeInTheDocument();
  });

  it("maps 'completed' to good", () => {
    const { container } = render(<StatusPill status="completed" />);
    expect(container.querySelector(".pill.good")).toBeInTheDocument();
  });

  it("maps 'overdue' to bad", () => {
    const { container } = render(<StatusPill status="overdue" />);
    expect(container.querySelector(".pill.bad")).toBeInTheDocument();
  });

  it("maps 'in progress' to warn", () => {
    const { container } = render(<StatusPill status="in progress" />);
    expect(container.querySelector(".pill.warn")).toBeInTheDocument();
  });

  it("maps 'closed' to mut", () => {
    const { container } = render(<StatusPill status="closed" />);
    expect(container.querySelector(".pill.mut")).toBeInTheDocument();
  });
});
