import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import NewRtiPage from "./page";

describe("NewRtiPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  // Regression test for the CRITICAL bug: the form posted to
  // fetch("/api/v1/crm/rti") instead of the only working client-mutation
  // prefix "/api/proxy/v1/crm/rti" — an RTI application could never actually
  // be filed, the request 404'd against the Next.js app itself every time.
  it("files the RTI request against the correct proxied endpoint and navigates to it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "new-rti-1" } }), { status: 201 }),
    );

    render(<NewRtiPage />);
    fireEvent.change(screen.getByLabelText(/^section/i), { target: { value: "s.6" } });
    fireEvent.change(screen.getByLabelText(/department \/ public authority/i), { target: { value: "Ministry of Finance" } });
    fireEvent.change(screen.getByLabelText(/^subject/i), { target: { value: "Copy of sanctioned budget" } });
    fireEvent.change(screen.getByLabelText(/description \/ particulars sought/i), { target: { value: "Please provide the FY26 budget breakup." } });
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Anil Sharma" } });
    fireEvent.click(screen.getByRole("button", { name: "File RTI Request" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/rti/new-rti-1"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/crm/rti");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.section).toBe("s.6");
    expect(body.departmentRef).toBe("Ministry of Finance");
    expect(body.applicantName).toBe("Anil Sharma");
  });

  it("shows the server error instead of navigating away on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Description is required" }), { status: 422 }),
    );

    render(<NewRtiPage />);
    fireEvent.change(screen.getByLabelText(/^section/i), { target: { value: "s.6" } });
    fireEvent.change(screen.getByLabelText(/department \/ public authority/i), { target: { value: "Ministry of Finance" } });
    fireEvent.change(screen.getByLabelText(/^subject/i), { target: { value: "Copy of sanctioned budget" } });
    fireEvent.change(screen.getByLabelText(/description \/ particulars sought/i), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Anil Sharma" } });
    fireEvent.click(screen.getByRole("button", { name: "File RTI Request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Description is required");
    expect(pushMock).not.toHaveBeenCalled();
  });
});
