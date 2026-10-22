import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TicketConversation } from "./TicketConversation";

const comments = [
  { id: "c1", createdAt: "2026-10-01", author: "agent", authorLabel: "agent", isInternal: false, content: "Public reply to the citizen" },
  { id: "c2", createdAt: "2026-10-02", author: "agent", authorLabel: "agent (internal)", isInternal: true, content: "Staff-only aside about the case" },
];

describe("TicketConversation staff-only notes", () => {
  it("Messages tab shows only citizen-visible messages", () => {
    render(<TicketConversation comments={comments} />);
    expect(screen.getByText("Public reply to the citizen")).toBeInTheDocument();
    expect(screen.queryByText("Staff-only aside about the case")).not.toBeInTheDocument();
  });

  it("Notes tab renders the internal notes (and hides the public message)", () => {
    render(<TicketConversation comments={comments} />);
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    expect(screen.getByText("Staff-only aside about the case")).toBeInTheDocument();
    expect(screen.getByText("agent (internal)")).toBeInTheDocument();
    expect(screen.queryByText("Public reply to the citizen")).not.toBeInTheDocument();
  });
});
