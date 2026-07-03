import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FileUpload } from "./FileUpload";

describe("ds/FileUpload", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders with default label", () => {
    render(<FileUpload />);
    expect(screen.getByText("Upload file")).toBeInTheDocument();
  });

  it("renders with custom label", () => {
    render(<FileUpload label="Upload Resume" />);
    expect(screen.getByText("Upload Resume")).toBeInTheDocument();
  });

  it("shows max size info", () => {
    render(<FileUpload maxSizeMb={5} />);
    expect(screen.getByText(/Max 5MB/)).toBeInTheDocument();
  });

  it("renders a file input", () => {
    render(<FileUpload />);
    const input = document.querySelector("input[type='file']");
    expect(input).toBeInTheDocument();
  });

  it("passes accept prop to file input", () => {
    render(<FileUpload accept=".pdf,.docx" />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    expect(input).toHaveAttribute("accept", ".pdf,.docx");
  });

  it("shows error when file exceeds max size", () => {
    render(<FileUpload maxSizeMb={1} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const bigFile = new File(["x".repeat(2 * 1024 * 1024)], "big.pdf");
    Object.defineProperty(bigFile, "size", { value: 2 * 1024 * 1024 });
    Object.defineProperty(input, "files", { value: [bigFile], configurable: true });
    fireEvent.change(input);
    expect(screen.getByText(/too large.*Maximum 1MB/)).toBeInTheDocument();
  });

  it("initiates upload for valid file", async () => {
    const mockPresignResponse = {
      uploadUrl: "https://s3.example.com/upload",
      key: "uploads/test.pdf",
      headers: {},
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(mockPresignResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const onUploaded = vi.fn();
    render(<FileUpload onUploaded={onUploaded} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["content"], "test.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith("uploads/test.pdf");
    });
  });

  it("shows error when presign request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }),
    );

    render(<FileUpload />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["content"], "test.pdf");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByText(/Forbidden|Could not prepare upload/)).toBeInTheDocument();
    });
  });
});
