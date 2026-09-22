import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it("renders a humanized status label when no explicit label is given", () => {
    render(<StatusPill status="active" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByText("active")).not.toBeInTheDocument();
  });

  // Regression coverage for the raw-enum-leak bug: Finance/Grants/Projects
  // status pills used to render the DB raw lowercase enum value verbatim
  // ("pending", "active", "na") instead of a real display label, because
  // StatusPill defaulted to the raw status string whenever a caller (most
  // call sites in the app) did not pass an explicit label prop.
  it("humanizes a plain lowercase status", () => {
    render(<StatusPill status="pending" />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("humanizes a snake_case status by replacing underscores and title-casing each word", () => {
    render(<StatusPill status="pending_approval" />);
    expect(screen.getByText("Pending Approval")).toBeInTheDocument();
  });

  it('renders the "na" three-way-match/status value as "N/A" instead of raw lowercase text', () => {
    render(<StatusPill status="na" />);
    expect(screen.getByText("N/A")).toBeInTheDocument();
    expect(screen.queryByText("na")).not.toBeInTheDocument();
  });

  it("humanizes an uppercase status consistently with its lowercase form", () => {
    render(<StatusPill status="APPROVED" />);
    expect(screen.getByText("Approved")).toBeInTheDocument();
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
