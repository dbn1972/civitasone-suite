import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PrintButton } from "./PrintButton";

describe("PrintButton", () => {
  it("renders print button", () => {
    render(<PrintButton />);
    expect(screen.getByRole("button")).toHaveTextContent("Print / PDF");
  });

  it("calls window.print on click", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<PrintButton />);
    fireEvent.click(screen.getByRole("button"));
    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it("sets and restores document title when title prop provided", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    document.title = "CivitasOne";
    render(<PrintButton title="Voucher #123" />);
    fireEvent.click(screen.getByRole("button"));
    expect(printSpy).toHaveBeenCalled();
    expect(document.title).toBe("CivitasOne");
    printSpy.mockRestore();
  });

  it("has title attribute for tooltip", () => {
    render(<PrintButton />);
    expect(screen.getByRole("button")).toHaveAttribute("title", "Print or save as PDF");
  });
});
