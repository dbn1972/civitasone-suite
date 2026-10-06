import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }) }));

import { UploadDocumentForm, validateName, type FolderOption } from "./UploadDocumentForm";

const FOLDERS: FolderOption[] = [
  { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "Budget", path: "/Budget" },
];

describe("UploadDocumentForm", () => {
  it("NEW-01: renders a real file input (not just name + tags)", () => {
    const { container } = render(<UploadDocumentForm folders={FOLDERS} defaultFolderId={null} />);
    expect(container.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  it("NEW-02: renders a folder selector populated from the folders prop", () => {
    render(<UploadDocumentForm folders={FOLDERS} defaultFolderId={null} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "/Budget" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Root (no folder)" })).toBeInTheDocument();
  });

  it("NEW-03: validateName rejects over-length and blocked extensions, accepts normal names", () => {
    expect(validateName("")).not.toBeNull();
    expect(validateName("x".repeat(501))).not.toBeNull();
    expect(validateName("malware.exe")).not.toBeNull();
    expect(validateName("Budget Report Q3.pdf")).toBeNull();
  });

  it("NEW-03/04: submitting with no file surfaces a role=alert error and blocks", async () => {
    render(<UploadDocumentForm folders={FOLDERS} defaultFolderId={null} />);
    const fetchSpy = vi.spyOn(global, "fetch");
    fireEvent.change(screen.getByLabelText(/File Name/), { target: { value: "ok.pdf" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Record/ }));
    expect(await screen.findByText("Select a file to upload.")).toBeInTheDocument();
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
