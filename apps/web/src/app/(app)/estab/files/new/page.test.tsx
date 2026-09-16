import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import NewFilePage from "./page";

describe("NewFilePage (estab) — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw backend text, when creating the file fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "dept quota exceeded for open files" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<NewFilePage />);
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "Road repair request" } });
    fireEvent.click(screen.getByRole("button", { name: "Create File" }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/dept quota exceeded/i);
    expect(document.body.textContent).not.toMatch(/\b422\b/);
  });
});
