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

  it("POSTs create obligation with an owner picked by name and expects 202 Accepted (GAP-CONTRACTS-DETAIL-03/06)", async () => {
    // GAP-CONTRACTS-DETAIL-03: owner is chosen from the identity user
    // directory, not pasted as a raw UUID. The picker fetches the users list;
    // the create POST sends the selected user's id.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/identity/users")) {
        return new Response(
          JSON.stringify({ data: [{ id: "11111111-1111-1111-1111-111111111111", name: "Asha Officer" }] }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ status: "accepted" }), { status: 202 });
    });
    render(<ObligationsPanel contractId="c1" obligations={[]} />);
    fireEvent.change(screen.getByPlaceholderText("Submit progress report"), {
      target: { value: "Submit BG" },
    });
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-09-01" } });

    // Owner is now a searchable picker — select by name (EntityPicker commits
    // on mousedown, see its test notes).
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "Asha" } });
    const option = await screen.findByText(/Asha Officer/);
    fireEvent.mouseDown(option);

    fireEvent.click(screen.getByRole("button", { name: "Add obligation" }));
    await waitFor(() => expect(screen.getByText(/received/i)).toBeInTheDocument());
    expect(screen.queryByText(/accepted \(queued\)/i)).not.toBeInTheDocument();

    const postCall = fetchSpy.mock.calls.find(([u]) => String(u).includes("/obligations"));
    expect(postCall).toBeTruthy();
    expect((postCall![1] as RequestInit).method).toBe("POST");
    const body = JSON.parse(String((postCall![1] as RequestInit).body));
    expect(body.ownerId).toBe("11111111-1111-1111-1111-111111111111");
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

  it("shows an error banner when Start fails (regression: Start has no confirm dialog to catch it)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("version conflict", { status: 409 }),
    );
    render(
      <ObligationsPanel
        contractId="c1"
        obligations={[
          { id: "ob-1", title: "Submit BG", status: "pending", version: 1, ownerId: "u1" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText(/This information was changed by someone else\. Refresh to see the latest version, then try again\./)).toBeInTheDocument());
    expect(screen.queryByText(/version conflict/i)).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText(/received/i)).toBeInTheDocument());
    expect(screen.queryByText(/accepted \(queued\)/i)).not.toBeInTheDocument();
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ status: "completed", version: 2 });
  });
});
