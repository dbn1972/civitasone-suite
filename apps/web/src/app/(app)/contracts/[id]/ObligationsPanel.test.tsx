import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { ObligationsPanel } from "./ObligationsPanel";

describe("ObligationsPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("POSTs create obligation and expects 202 Accepted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<ObligationsPanel contractId="c1" obligations={[]} />);
    fireEvent.change(screen.getByPlaceholderText("Submit progress report"), {
      target: { value: "Submit BG" },
    });
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByPlaceholderText("uuid"), { target: { value: "user-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add obligation" }));
    await waitFor(() => expect(screen.getByText(/accepted \(queued\)/i)).toBeInTheDocument());
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("/obligations");
    expect((fetchSpy.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("PATCHes obligation status advance and expects 202", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(
      <ObligationsPanel
        contractId="c1"
        obligations={[
          {
            id: "ob-1",
            title: "Submit BG",
            status: "pending",
            version: 1,
            dueDate: "2026-09-01",
            ownerId: "u1",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("/obligations/ob-1");
    expect((fetchSpy.mock.calls[0]![1] as RequestInit).method).toBe("PATCH");
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
    expect(body).toMatchObject({ status: "in_progress", version: 1 });
  });

  it("marking complete is gated behind a confirmation (terminal, cannot be reopened)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(
      <ObligationsPanel
        contractId="c1"
        obligations={[
          { id: "ob-1", title: "Submit BG", status: "in_progress", version: 2, ownerId: "u1" },
        ]}
      />,
    );
    // "Start" must not be offered once past pending.
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Yes, mark complete" }));
    await waitFor(() => expect(screen.getByText(/accepted \(queued\)/i)).toBeInTheDocument());
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ status: "completed", version: 2 });
  });
});
