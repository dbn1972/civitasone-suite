import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

  it("exposes rows as keyboard-focusable (tabIndex 0) with an accessible link role", () => {
    render(<FilesTable rows={ROWS} />);

    const row = screen.getByRole("link", { name: "Open F/2026/001" });
    expect(row.tagName).toBe("TR");
    expect(row).toHaveAttribute("tabindex", "0");
  });
});
