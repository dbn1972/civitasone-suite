import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateStructureForm } from "./CreateStructureForm";

describe("CreateStructureForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a name before opening the confirm dialog", () => {
    render(<CreateStructureForm />);
    fireEvent.click(screen.getByText("Create Structure"));
    expect(screen.getByText("Structure name is required.")).toBeInTheDocument();
  });

  it("creates a structure on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "new-struct-1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    render(<CreateStructureForm />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Grade Pay A" } });
    fireEvent.click(screen.getByText("Create Structure"));

    await waitFor(() => expect(screen.getByText("Create this pay structure?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create structure"));

    await waitFor(() => {
      expect(screen.getByText(/Structure submitted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/status (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<CreateStructureForm />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Grade Pay B" } });
    fireEvent.click(screen.getByText("Create Structure"));

    await waitFor(() => expect(screen.getByText("Create this pay structure?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create structure"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 500/)).not.toBeInTheDocument();
  });
});
