import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/_components/ds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/_components/ds")>();
  return {
    ...actual,
    useToast: () => ({
      toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
    }),
  };
});

import { MasterCreateForm } from "./MasterCreateForm";

describe("MasterCreateForm — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when the backend does not accept (202) the create", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));

    render(<MasterCreateForm masterType="work-types" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Work Types" }));
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Road" } });
    fireEvent.change(screen.getByLabelText(/^Code/i), { target: { value: "RD" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
    // The legitimate client-side validation messages ("... is required") must
    // still work unchanged — they are not part of this fix.
  });

  it("still shows the legitimate client-side validation message unchanged when a required field is empty", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<MasterCreateForm masterType="work-types" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Work Types" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Name is required/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
