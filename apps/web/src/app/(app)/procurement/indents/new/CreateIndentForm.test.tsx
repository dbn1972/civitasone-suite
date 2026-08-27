import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { CreateIndentForm } from "./CreateIndentForm";

async function fillOneLineItem() {
  fireEvent.change(await screen.findByLabelText("Item code, row 1"), { target: { value: "PEN-001" } });
  fireEvent.change(screen.getByLabelText("Description, row 1"), { target: { value: "Ball pens" } });
}

describe("CreateIndentForm — purpose is required and actually sent (regression)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "11111111-1111-1111-1111-111111111111", status: "accepted" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  // Bug: the backend's createIndentBody requires `purpose` (min 3 chars) —
  // see services/procurement-service/src/modules/indent/validators.ts — but
  // this form never collected or sent it at all, so every real submission
  // failed server-side validation. This guards against that regressing.
  it("blocks submit and never calls the API when purpose is empty", async () => {
    render(<CreateIndentForm />);
    await fillOneLineItem();

    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/purpose/i);
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("sends the typed text as `purpose` in the request body, not `remarks`", async () => {
    render(<CreateIndentForm />);
    await fillOneLineItem();
    fireEvent.change(screen.getByLabelText("Purpose / justification *"), {
      target: { value: "Replenish office stationery for Q3" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.purpose).toBe("Replenish office stationery for Q3");
    expect(body).not.toHaveProperty("remarks");
  });

  // Bug: on failure this form used to show the raw backend JSON error body
  // (e.g. `{"code":"VALIDATION_FAILED",...}`) verbatim to the clerk, which
  // apps/web/src/lib/messages.ts (R5/R6) exists specifically to prevent.
  it("shows a clerk-safe message, not raw server JSON, when the API call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "VALIDATION_FAILED", message: "invalid request", fieldErrors: [] }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<CreateIndentForm />);
    await fillOneLineItem();
    fireEvent.change(screen.getByLabelText("Purpose / justification *"), {
      target: { value: "Replenish office stationery for Q3" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/VALIDATION_FAILED/);
    expect(alert.textContent).toMatch(/couldn't save/i);
  });
});
