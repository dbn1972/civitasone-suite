import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RaiseEOfficeNote } from "./RaiseEOfficeNote";

const EMPLOYEES = [
  { id: "12345678-1234-1234-1234-123456789012", employeeNo: "E-001", name: "Asha Rao", department: "Finance" },
  { id: "abcdefab-abcd-abcd-abcd-abcdefabcdef", employeeNo: "E-002", name: "Ben Iyer", department: "Finance" },
];

// GAP-HR-DISCIPLINARY-DETAIL-05: the two officer fields are now an
// EntityPicker (search-then-select), not raw UUID text inputs, so the
// fetch mock must also answer the employee-search adapter's own request
// (searchEmployees -> GET /api/proxy/v1/hrms/employees?q=...) alongside the
// pre-existing file-status and submit calls.
function mockFetch(overrides?: { submit?: Response }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/estab/files/by-ref")) {
      return new Response(null, { status: 404 });
    }
    if (url.includes("/hrms/employees")) {
      return new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 });
    }
    if (url.includes("/estab/files/from-module")) {
      return overrides?.submit ?? new Response(
        JSON.stringify({ id: "new-file", fileNo: "EO/FIN/2026/002" }),
        { status: 201 },
      );
    }
    return new Response(null, { status: 404 });
  });
}

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

  it("requires both officers to be chosen before submitting (GAP-HR-DISCIPLINARY-DETAIL-05)", async () => {
    render(<RaiseEOfficeNote {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByText("Raise for approval")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Raise for approval"));
    await waitFor(() => {
      expect(screen.getByText("Submit to eOffice")).toBeInTheDocument();
    });
    // Try to submit without choosing either officer
    fireEvent.click(screen.getByText("Submit to eOffice"));
    await waitFor(() => {
      expect(screen.getByText(/Choose the initiating officer/i)).toBeInTheDocument();
    });
  });

  it("no longer accepts a raw pasted UUID with nothing selected from the picker", async () => {
    // Regression guard for the original bug: typing text into the search
    // box (even a well-formed UUID) is a QUERY, not a selection -- only
    // choosing a result from the dropdown sets the picker's value. Typing
    // alone must not satisfy the "officer chosen" validation.
    mockFetch();
    render(<RaiseEOfficeNote {...baseProps} />);
    await waitFor(() => expect(screen.getByText("Raise for approval")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Raise for approval"));

    const initiatingInput = screen.getByLabelText("Initiating officer");
    fireEvent.change(initiatingInput, { target: { value: "12345678-1234-1234-1234-123456789012" } });
    await screen.findByText("Asha Rao (E-001)");
    // Deliberately do NOT click the result -- just typed, nothing selected.

    fireEvent.click(screen.getByText("Submit to eOffice"));
    await waitFor(() => {
      expect(screen.getByText(/Choose the initiating officer/i)).toBeInTheDocument();
    });
  });

  it("submits successfully once both officers are chosen from the picker", async () => {
    const fetchMock = mockFetch();

    render(<RaiseEOfficeNote {...baseProps} />);
    await waitFor(() => expect(screen.getByText("Raise for approval")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Raise for approval"));

    const initiatingInput = screen.getByLabelText("Initiating officer");
    fireEvent.change(initiatingInput, { target: { value: "Asha" } });
    fireEvent.mouseDown(await screen.findByText("Asha Rao (E-001)"));
    expect(await screen.findByDisplayValue("Asha Rao (E-001)")).toBeInTheDocument();

    const forwardInput = screen.getByLabelText("Forward to officer");
    fireEvent.change(forwardInput, { target: { value: "Ben" } });
    fireEvent.mouseDown(await screen.findByText("Ben Iyer (E-002)"));
    expect(await screen.findByDisplayValue("Ben Iyer (E-002)")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Justification/i), {
      target: { value: "Please approve this sanction." },
    });

    fireEvent.click(screen.getByText("Submit to eOffice"));
    await waitFor(() => {
      expect(screen.getByText(/Raised eFile EO\/FIN\/2026\/002/)).toBeInTheDocument();
    });

    const submitCall = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return url.includes("/estab/files/from-module");
    });
    expect(submitCall).toBeTruthy();
    const body = JSON.parse((submitCall![1] as RequestInit).body as string);
    expect(body.initiatedBy).toBe("12345678-1234-1234-1234-123456789012");
    expect(body.currentWith).toBe("abcdefab-abcd-abcd-abcd-abcdefabcdef");
  });
});
