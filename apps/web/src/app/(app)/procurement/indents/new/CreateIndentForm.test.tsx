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

  // UX-003: the shared useFormError hook must render the backend's per-field
  // fieldErrors inline, not just the generic toHumanError summary line.
  it("renders inline field-level messages from a fieldErrors response, not just a raw error string", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          message: "validation_failed",
          fieldErrors: [{ field: "department", message: "Department must be a recognised office code." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    render(<CreateIndentForm />);
    await fillOneLineItem();
    fireEvent.change(screen.getByLabelText("Purpose / justification *"), {
      target: { value: "Replenish office stationery for Q3" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));

    expect(
      await screen.findByText("Department must be a recognised office code."),
    ).toBeInTheDocument();
  });

  // UX-003: never show a raw HTTP status code or raw server error text, even
  // for a non-JSON / plain-text failure body.
  it("never surfaces a raw status code or raw server text on a plain-text 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error\n at Object.<anonymous> (/srv/indent.js:12:3)", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );
    render(<CreateIndentForm />);
    await fillOneLineItem();
    fireEvent.change(screen.getByLabelText("Purpose / justification *"), {
      target: { value: "Replenish office stationery for Q3" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/\b500\b/);
    expect(alert.textContent).not.toMatch(/Internal Server Error/);
    expect(alert.textContent).not.toMatch(/at Object\.<anonymous>/);
  });
});
