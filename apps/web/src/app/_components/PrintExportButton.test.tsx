import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PrintExportButton } from "./PrintExportButton";

/**
 * UX-008 tranche 9: PrintExportButton had no dedicated test file before this
 * tranche converted its raw button element to the shared Button and replaced its
 * unused `className` prop with a typed `variant` — added here to guard the
 * new prop surface and the existing window.print()/documentTitle behavior.
 */
describe("PrintExportButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the default 'Export' label as a real button", () => {
    render(<PrintExportButton />);
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("renders a custom label", () => {
    render(<PrintExportButton label="Export PDF" />);
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeInTheDocument();
  });

  it("defaults to the ghost variant", () => {
    render(<PrintExportButton />);
    expect(screen.getByRole("button", { name: "Export" })).toHaveClass("btn", "ghost");
  });

  it("applies a variant override", () => {
    render(<PrintExportButton variant="primary" />);
    expect(screen.getByRole("button", { name: "Export" })).toHaveClass("btn", "primary");
  });

  it("calls window.print on click", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<PrintExportButton />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("swaps document.title for the print call, then restores it, when documentTitle is set", () => {
    const originalTitle = document.title;
    document.title = "Original Title";
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {
      // Assert mid-print, while the swapped title is in effect.
      expect(document.title).toBe("Custom Export Title");
    });
    render(<PrintExportButton documentTitle="Custom Export Title" />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(document.title).toBe("Original Title");
    document.title = originalTitle;
  });

  it("does not touch document.title when documentTitle is not set", () => {
    const originalTitle = document.title;
    document.title = "Unchanged Title";
    vi.spyOn(window, "print").mockImplementation(() => {});
    render(<PrintExportButton />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(document.title).toBe("Unchanged Title");
    document.title = originalTitle;
  });
});
