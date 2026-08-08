import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NotificationMatrix } from "./NotificationMatrix";
import { seedMatrixForPattern } from "./notificationTypes";

describe("NotificationMatrix", () => {
  it("opens the editor when an enabled cell is clicked instead of turning it off", () => {
    const matrix = seedMatrixForPattern("certificate");
    const onChange = vi.fn();
    render(<NotificationMatrix matrix={matrix} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText(/Edit Application submitted SMS template/i));

    expect(screen.getByRole("heading", { name: /Edit template/i })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("enables an Off cell and opens the editor", () => {
    const matrix = seedMatrixForPattern("certificate");
    // Ensure WhatsApp submitted is off in seed — if pre-seeded, pick a known-off cell
    const onChange = vi.fn();
    render(<NotificationMatrix matrix={matrix} onChange={onChange} />);

    const offButtons = screen.getAllByRole("button", { name: /Enable /i });
    expect(offButtons.length).toBeGreaterThan(0);
    fireEvent.click(offButtons[0]);
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /Edit template/i })).toBeInTheDocument();
  });
});
