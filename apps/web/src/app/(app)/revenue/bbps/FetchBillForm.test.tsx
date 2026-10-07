import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FetchBillForm } from "./FetchBillForm";

/** Route the global fetch mock by URL: submit vs status poll. */
function mockFetchRouting(statusBody: Record<string, unknown>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/bbps/requests/")) {
      return Promise.resolve(new Response(JSON.stringify({ data: statusBody }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ data: { messageId: "msg-1" } }), { status: 202 }));
  });
}

describe("FetchBillForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires an assessee identifier before submitting", () => {
    render(<FetchBillForm />);
    fireEvent.click(screen.getByRole("button", { name: "Fetch Bill" }));
    expect(screen.getByText(/Enter the assessee identifier/)).toBeInTheDocument();
  });

  it("submits the fetch-bill request and tracks its outcome (happy path, GAP-REVENUE-BBPS-02)", async () => {
    mockFetchRouting({ messageId: "msg-1", status: "success" });

    render(<FetchBillForm />);
    fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-001" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch Bill" }));

    await waitFor(() => {
      expect(screen.getByText(/tracking its outcome below/)).toBeInTheDocument();
    });
    // The polled status becomes visible.
    await waitFor(() => {
      expect(screen.getByText("Fetch status:")).toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it("surfaces a clerk-safe error, never the server's raw code/message (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "BBPS_DISABLED", message: "BBPS not enabled" } }), { status: 403 }),
    );

    render(<FetchBillForm />);
    fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-001" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch Bill" }));

    await waitFor(() => {
      expect(screen.getByText(/You don't have permission to do this\. Ask your administrator if you need access\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/BBPS_DISABLED: BBPS not enabled/)).not.toBeInTheDocument();
  });
});
