import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));

import { InboxPanel, type InboxRow } from "./InboxPanel";

// GAP-ESTAB-DASHBOARD-01: the My Desk SLA pill follows the same rule as the 'Overdue on my desk' tile.
const row = (id: string, fileNo: string, statusRaw: string, dueDate: string): InboxRow => ({
  id, fileNo, subject: `Subject ${fileNo}`, status: statusRaw, statusRaw, dueDate,
});

const ROWS: InboxRow[] = [
  row("a", "F/OPEN", "active", "2020-01-01"),
  row("c", "F/CLOSED", "closed", "2020-01-01"),
  row("x", "F/ARCHIVED", "archived", "2020-01-01"),
  row("f", "F/FUTURE", "active", "2999-01-01"),
];

/** The SLA pill of the row for this file (the last .pill in the row; the status cell has its own pill). */
function slaPill(fileNo: string): HTMLElement {
  const tr = screen.getByRole("link", { name: `Open ${fileNo}` }).closest("tr") as HTMLElement;
  const pills = tr.querySelectorAll<HTMLElement>("span.pill");
  return pills[pills.length - 1] as HTMLElement;
}

describe("InboxPanel — SLA pill (GAP-ESTAB-DASHBOARD-01)", () => {
  it("Given a past-due open file, Then its pill reads overdue and is red", () => {
    render(<InboxPanel rows={ROWS} />);
    const pill = slaPill("F/OPEN");
    expect(pill.textContent).toMatch(/^overdue \d+d$/);
    expect(pill.className).toContain("bad");
  });

  it("Given past-due closed and archived files, Then their pill is neutral, never overdue or red", () => {
    render(<InboxPanel rows={ROWS} />);
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    for (const fileNo of ["F/CLOSED", "F/ARCHIVED"]) {
      const pill = slaPill(fileNo);
      expect(pill.textContent).toBe("—");
      expect(pill.className).toContain("mut");
      expect(pill.className).not.toContain("bad");
      expect(within(screen.getByRole("link", { name: `Open ${fileNo}` }).closest("tr") as HTMLElement).queryByText(/overdue/)).toBeNull();
    }
  });

  it("an open file that is not yet due still shows its days left", () => {
    render(<InboxPanel rows={ROWS} />);
    expect(slaPill("F/FUTURE").className).toContain("good");
    expect(slaPill("F/FUTURE").textContent).toMatch(/d left$/);
  });
});
