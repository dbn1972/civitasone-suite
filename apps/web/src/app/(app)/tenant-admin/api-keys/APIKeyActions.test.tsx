import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { APIKeyActions } from "./APIKeyActions";

describe("APIKeyActions — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body, when creating a key fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("internal error: connection to vault timed out", { status: 500 }),
    );

    render(<APIKeyActions keys={[]} />);
    fireEvent.change(screen.getByLabelText(/Key name/i), { target: { value: "Reporting service" } });
    fireEvent.click(screen.getByRole("button", { name: "Create API Key" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't save/i));
    expect(screen.getByRole("alert").textContent).not.toMatch(/vault timed out/i);
    expect(screen.getByRole("alert").textContent).not.toMatch(/\b500\b/);
  });

  it("shows a clerk-safe message in the confirm dialog, never the raw response body, when revoking a key fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "key already revoked" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    render(
      <APIKeyActions keys={[{ id: "k1", keyName: "Reporting service", status: "active" }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "no longer needed" } });
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Revoke key");
    fireEvent.click(confirmBtn!);

    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/key already revoked/i);
    expect(dialog.textContent).not.toMatch(/\b409\b/);
  });
});
