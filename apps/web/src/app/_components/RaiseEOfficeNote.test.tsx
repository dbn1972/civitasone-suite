import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RaiseEOfficeNote } from "./RaiseEOfficeNote";

describe("RaiseEOfficeNote", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default: no existing linked file
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 404 }),
    );
  });

  const baseProps = {
    refType: "finance_sanction",
    refId: "abc-123",
    subject: "FY26 Budget Sanction",
    dept: "Finance",
  };

  it("renders the 'Raise eOffice note' button", async () => {
    render(<RaiseEOfficeNote {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByText("Raise for approval")).toBeInTheDocument();
    });
  });

  it("shows loading state initially", () => {
    render(<RaiseEOfficeNote {...baseProps} />);
    // Loading indicator while checking existing file status
    expect(document.querySelector("[style]")).toBeTruthy();
  });

  it("shows linked file status when file exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { id: "f1", file_no: "EO/FIN/2026/001", status: "pending" } }),
        { status: 200 },
      ),
    );
    render(<RaiseEOfficeNote {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByText("EO/FIN/2026/001")).toBeInTheDocument();
    });
  });

  it("opens form dialog on button click", async () => {
    render(<RaiseEOfficeNote {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByText("Raise for approval")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Raise for approval"));
    // Form fields should appear
    await waitFor(() => {
      expect(screen.getByText(/Initiating Officer|Initiated/i)).toBeInTheDocument();
    });
  });

  it("validates UUID format for officer fields", async () => {
    render(<RaiseEOfficeNote {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByText("Raise for approval")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Raise for approval"));
    await waitFor(() => {
      expect(screen.getByText("Submit to eOffice")).toBeInTheDocument();
    });
    // Try to submit without filling fields
    fireEvent.click(screen.getByText("Submit to eOffice"));
    await waitFor(() => {
      expect(screen.getByText(/valid ID|officer.*must/i)).toBeInTheDocument();
    });
  });

  it("submits successfully with valid data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 404 })) // load status
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "new-file", fileNo: "EO/FIN/2026/002" }), { status: 201 }),
      ); // submit

    render(<RaiseEOfficeNote {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByText("Raise for approval")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Raise for approval"));
    await waitFor(() => {
      const inputs = document.querySelectorAll("input");
      expect(inputs.length).toBeGreaterThanOrEqual(2);
    });

    // Fill in valid UUIDs
    const inputs = document.querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "12345678-1234-1234-1234-123456789012" } });
    fireEvent.change(inputs[1], { target: { value: "abcdefab-abcd-abcd-abcd-abcdefabcdef" } });
    // Fill note
    const textarea = document.querySelector("textarea");
    if (textarea) fireEvent.change(textarea, { target: { value: "Please approve this sanction." } });

    fireEvent.click(screen.getByText("Submit to eOffice"));
    await waitFor(() => {
      // Should call the API
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
