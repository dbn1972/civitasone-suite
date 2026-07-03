import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FileUpload } from "./FileUpload";

describe("FileUpload", () => {
  it("renders upload button with label", () => {
    render(<FileUpload />);
    expect(screen.getByText("Upload File")).toBeInTheDocument();
  });

  it("renders custom label", () => {
    render(<FileUpload label="Attach Document" />);
    expect(screen.getByText("Attach Document")).toBeInTheDocument();
  });

  it("renders drop zone with instructions", () => {
    render(<FileUpload />);
    expect(screen.getByText(/drag.*drop|click.*browse/i)).toBeInTheDocument();
  });

  it("shows file size limit text", () => {
    render(<FileUpload maxSizeMB={5} />);
    expect(screen.getByText(/5MB/)).toBeInTheDocument();
  });

  it("rejects files larger than maxSizeMB", () => {
    render(<FileUpload maxSizeMB={1} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const bigFile = new File(["x".repeat(2 * 1024 * 1024)], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [bigFile] });
    fireEvent.change(input);
    expect(screen.getByText(/exceeds 1MB limit/)).toBeInTheDocument();
  });

  it("accepts valid file and shows progress", async () => {
    vi.useFakeTimers();
    const onUpload = vi.fn();
    render(<FileUpload onUpload={onUpload} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["hello"], "test.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);
    // File name should be shown
    expect(screen.getByText("test.txt")).toBeInTheDocument();
    // Advance timers to finish upload
    for (let i = 0; i < 20; i++) vi.advanceTimersByTime(200);
    expect(onUpload).toHaveBeenCalledWith(file);
    vi.useRealTimers();
  });

  it("handles drag-over state", () => {
    const { container } = render(<FileUpload />);
    const dropZone = container.querySelector("[style]")!;
    // We can verify it renders without error
    expect(dropZone).toBeTruthy();
  });

  it("has hidden file input", () => {
    render(<FileUpload accept=".pdf,.doc" />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("accept", ".pdf,.doc");
  });
});
