import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));

import { FilesTable, type FileRow } from "./FilesTable";

const ROWS: FileRow[] = [
  {
    id: "file-1",
    fileNo: "F/2026/001",
    subject: "Sanction of leave",
    classification: "General",
    department: "Estab",
    createdBy: "priya",
    status: "active",
    statusRaw: "active",
  },
  {
    id: "file-2",
    fileNo: "F/2026/002",
    subject: "Procurement note",
    classification: "Confidential",
    department: "Estab",
    createdBy: "meera",
    status: "pending",
    statusRaw: "pending",
  },
];

describe("FilesTable — keyboard row navigation", () => {
  it("navigates to the file detail page when a row is focused and Enter is pressed", () => {
    render(<FilesTable rows={ROWS} />);

    const row = screen.getByRole("link", { name: "Open F/2026/001" });
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/estab/files/file-1");
  });

  it("navigates to the file detail page when a row is focused and Space is pressed", () => {
    render(<FilesTable rows={ROWS} />);

    const row = screen.getByRole("link", { name: "Open F/2026/002" });
    row.focus();
    fireEvent.keyDown(row, { key: " " });

    expect(pushMock).toHaveBeenCalledWith("/estab/files/file-2");
  });

  it("exposes each row as a keyboard-focusable link to its file", () => {
    render(<FilesTable rows={ROWS} />);

    // The accessible "Open <fileNo>" link provided by DataTable is the single keyboard-focusable
    // control for the row (Enter/Space navigation is covered above). The <tr> itself is NOT a tab
    // stop / role=button: a focusable link nested in an interactive row is an axe
    // "nested-interactive" violation (WCAG 4.1.2).
    const link = screen.getByRole("link", { name: "Open F/2026/001" });
    expect(link).not.toHaveAttribute("tabindex", "-1");
    const row = link.closest("tr");
    expect(row).not.toBeNull();
    expect(row).not.toHaveAttribute("tabindex");
    expect(row).not.toHaveAttribute("role", "button");
  });
});


describe("FilesTable — closed files (GAP-ESTAB-FILES-DETAIL-01)", () => {
  const withClosed: FileRow[] = [
    ...ROWS,
    {
      id: "file-3", fileNo: "F/2026/003", subject: "Closed matter", classification: "General", department: "Estab",
      createdBy: "meera", status: "closed", statusRaw: "closed", dueDate: "2020-01-01",
    },
  ];

  it("the Closed segment includes a closed file, and the Active segment does not", () => {
    render(<FilesTable rows={withClosed} />);
    fireEvent.click(screen.getByRole("tab", { name: "Closed" }));
    expect(screen.getByText("Closed matter")).toBeInTheDocument();
    expect(screen.queryByText("Sanction of leave")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Active" }));
    expect(screen.queryByText("Closed matter")).not.toBeInTheDocument();
    expect(screen.getByText("Sanction of leave")).toBeInTheDocument();
  });

  it("a closed file past its due date is not flagged overdue", () => {
    render(<FilesTable rows={withClosed} />);
    const row = screen.getByText("Closed matter").closest("tr") as HTMLElement;
    const due = within(row).getByText(/2020/);
    expect(due.getAttribute("style") ?? "").not.toContain("var(--bad)");
  });
});
