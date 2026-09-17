import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { CreateSchemeForm } from "./CreateSchemeForm";

describe("CreateSchemeForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  function fillForm() {
    fireEvent.change(screen.getByLabelText(/scheme name/i), { target: { value: "PM Kisan Samman Nidhi" } });
    fireEvent.change(screen.getByLabelText(/scheme code/i), { target: { value: "PM-KISAN-2024" } });
    fireEvent.change(screen.getByLabelText(/total budget/i), { target: { value: "500000" } });
  }

  it("submits the scheme to the correct proxied endpoint and navigates on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 201 }));

    render(<CreateSchemeForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Scheme" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/grants/schemes"));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/grants/schemes");
    expect((init as RequestInit).method).toBe("POST");
  });

  // UX-016: this used to show the RAW response body text verbatim
  // (`text || \`Request failed (${status})\``), not even parsed as JSON. It
  // must now show only the catalogued, clerk-safe copy — never the raw
  // server text.
  it("shows a clerk-safe error, not the raw server text, on a failed submit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("grant-service: scheme code already exists", { status: 409 }),
    );

    render(<CreateSchemeForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Scheme" }));

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText(/scheme code already exists/)).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
