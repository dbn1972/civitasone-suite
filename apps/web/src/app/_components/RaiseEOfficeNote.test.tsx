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

// ── GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-01 / -03 ───────────────────────────
describe("RaiseEOfficeNote classification, error mapping and notify warning", () => {
  const props = { refType: "finance_sanction", refId: "abc-123", subject: "FY26 Sanction", dept: "Finance", notifyPath: "/api/proxy/v1/finance/sanctions/abc-123/submit-approval" };

  function mockAll(opts: { submit?: Response; notify?: Response | "reject" }) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/estab/files/by-ref")) return new Response(null, { status: 404 });
      if (url.includes("/hrms/employees")) return new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 });
      if (url.includes("/estab/files/from-module")) {
        return opts.submit ?? new Response(JSON.stringify({ id: "new-file", fileNo: "EO/FIN/2026/002" }), { status: 201 });
      }
      if (url.includes("submit-approval")) {
        if (opts.notify === "reject") throw new TypeError("Failed to fetch");
        return opts.notify ?? new Response(null, { status: 202 });
      }
      return new Response(null, { status: 404 });
    });
  }

  async function fillAndSubmit(skipOpen = false) {
    if (!skipOpen) {
      await waitFor(() => expect(screen.getByText("Raise for approval")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Raise for approval"));
    }
    fireEvent.change(screen.getByLabelText("Initiating officer"), { target: { value: "Asha" } });
    fireEvent.mouseDown(await screen.findByText("Asha Rao (E-001)"));
    await screen.findByDisplayValue("Asha Rao (E-001)");
    fireEvent.change(screen.getByLabelText("Forward to officer"), { target: { value: "Ben" } });
    fireEvent.mouseDown(await screen.findByText("Ben Iyer (E-002)"));
    await screen.findByDisplayValue("Ben Iyer (E-002)");
    fireEvent.change(screen.getByPlaceholderText(/Justification/i), { target: { value: "Please approve this sanction." } });
    fireEvent.click(screen.getByText("Submit to eOffice"));
  }

  beforeEach(() => vi.restoreAllMocks());

  it("shows the classification being applied and sends the chosen value", async () => {
    const fetchMock = mockAll({});
    render(<RaiseEOfficeNote {...props} classification="secret" />);
    await waitFor(() => expect(screen.getByText("Raise for approval")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Raise for approval"));
    const select = screen.getByLabelText("Classification") as HTMLSelectElement;
    expect(select.value).toBe("secret");
    fireEvent.change(select, { target: { value: "public" } });
    await fillAndSubmit(true);
    await waitFor(() => expect(screen.getByText(/Raised eFile EO\/FIN\/2026\/002/)).toBeInTheDocument());
    const call = fetchMock.mock.calls.find(([i]) => String(typeof i === "string" ? i : (i as Request).url).includes("from-module"))!;
    expect(JSON.parse((call[1] as RequestInit).body as string).classification).toBe("public");
  });

  it("a failed raise shows plain language, never the raw response body", async () => {
    mockAll({ submit: new Response(JSON.stringify({ code: "VALIDATION", message: "approvalChain invalid", stack: "at x" }), { status: 400 }) });
    render(<RaiseEOfficeNote {...props} />);
    await fillAndSubmit();
    const msg = await screen.findByText(/couldn't save/i);
    expect(msg.textContent).not.toMatch(/VALIDATION|approvalChain|stack|\{/);
  });

  it("raising succeeds but a failed notifyPath (500) shows a warning alert", async () => {
    mockAll({ notify: new Response(null, { status: 500 }) });
    render(<RaiseEOfficeNote {...props} />);
    await fillAndSubmit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/eFile was raised, but the record could not be marked as awaiting approval/);
    expect(screen.getByText(/Raised eFile EO\/FIN\/2026\/002/)).toBeInTheDocument();
  });

  it("a network error on notifyPath also warns, and a healthy notify shows no alert", async () => {
    mockAll({ notify: "reject" });
    const { unmount } = render(<RaiseEOfficeNote {...props} />);
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be marked/);
    unmount();
    vi.restoreAllMocks();
    mockAll({});
    render(<RaiseEOfficeNote {...props} />);
    await fillAndSubmit();
    await screen.findByText(/Raised eFile/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a rejected linked file offers no re-raise by default, but does when allowRaiseAfterTerminal is set", async () => {
    const file = { id: "f1", file_no: "EO/FIN/2026/001", status: "rejected" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: file }), { status: 200 }));
    const { unmount } = render(<RaiseEOfficeNote {...props} />);
    await screen.findByText("EO/FIN/2026/001");
    expect(screen.queryByText("Raise for approval")).not.toBeInTheDocument();
    unmount();
    render(<RaiseEOfficeNote {...props} allowRaiseAfterTerminal />);
    expect(await screen.findByText("Raise for approval")).toBeInTheDocument();
  });
});
