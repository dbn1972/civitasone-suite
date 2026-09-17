import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import ApplyPage from "./page";

describe("ApplyPage (grant scheme application)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  function fillForm() {
    fireEvent.change(screen.getByLabelText(/beneficiary id/i), {
      target: { value: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
    });
    fireEvent.change(screen.getByLabelText(/project purpose/i), {
      target: { value: "Construction of a new anganwadi centre building." },
    });
    fireEvent.change(screen.getByLabelText(/requested amount/i), { target: { value: "500000" } });
  }

  it("submits the application to the correct proxied endpoint and shows the queued confirmation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 201 }));

    render(<ApplyPage params={{ id: "scheme-1" }} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit Application" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/grants/schemes/scheme-1/applications");
    expect((init as RequestInit).method).toBe("POST");
    expect(await screen.findByText(/submitted successfully/i)).toBeInTheDocument();
  });

  // UX-016: this used to show the RAW response body text verbatim
  // (`text || \`Submission failed (HTTP ${status})\``), not even parsed as
  // JSON. It must now show only the catalogued, clerk-safe copy — never the
  // raw server text.
  it("shows a clerk-safe error, not the raw server text, on a failed submit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("grant-service: scheme budget exhausted for FY26", { status: 422 }),
    );

    render(<ApplyPage params={{ id: "scheme-1" }} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit Application" }));

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText(/budget exhausted/)).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
