import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds/Toast";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import AccountCompilePage from "./page";

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

/**
 * UX-016: on failure this page used to show `data.message ??
 * \`Request failed (${res.status})\`` — the raw backend message, or the raw
 * HTTP status in parens — directly in a role="alert" box. It now routes
 * through useFormError and never surfaces either.
 */
describe("AccountCompilePage — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when the compile request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 409, headers: { "content-type": "application/json" } }),
    );
    renderWithToast(<AccountCompilePage />);

    fireEvent.change(screen.getByLabelText(/Submitted To/i), {
      target: { value: "District Treasury Officer, Nashik" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Compile Account" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't save/i);
    expect(alert.textContent).not.toMatch(/409/);
  });

  it("never surfaces raw server text on a plain-text failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error\n at Object.<anonymous> (/srv/works.js:5:1)", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );
    renderWithToast(<AccountCompilePage />);

    fireEvent.change(screen.getByLabelText(/Submitted To/i), {
      target: { value: "District Treasury Officer, Nashik" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Compile Account" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/\b500\b/);
    expect(alert.textContent).not.toMatch(/Internal Server Error/);
    expect(alert.textContent).not.toMatch(/at Object\.<anonymous>/);
  });

  it("still submits successfully and initiates the compile", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 202, headers: { "content-type": "application/json" } }),
    );
    renderWithToast(<AccountCompilePage />);

    fireEvent.change(screen.getByLabelText(/Submitted To/i), {
      target: { value: "District Treasury Officer, Nashik" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Compile Account" }));

    await waitFor(() =>
      expect(screen.getByText("✅ Account compile submitted. Redirecting to billing…")).toBeInTheDocument(),
    );
  });
});
