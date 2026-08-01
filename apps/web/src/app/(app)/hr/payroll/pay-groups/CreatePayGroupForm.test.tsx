import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreatePayGroupForm } from "./CreatePayGroupForm";

describe("CreatePayGroupForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a name before opening the confirm dialog", () => {
    render(<CreatePayGroupForm />);
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));
    expect(screen.getByText("Pay group name is required.")).toBeInTheDocument();
  });

  it("creates a pay group on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { id: "pg1", name: "Weekly Wage Staff", frequency: "monthly", payDayOfMonth: 28, timezone: "Asia/Kolkata", status: "active" } }),
        { status: 201 },
      ),
    );

    render(<CreatePayGroupForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Weekly Wage Staff" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));

    await waitFor(() => expect(screen.getByText("Create this pay group?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create pay group"));

    await waitFor(() => {
      expect(screen.getByText(/Pay group "Weekly Wage Staff" created\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 409 }));

    render(<CreatePayGroupForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Duplicate Group" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));

    await waitFor(() => expect(screen.getByText("Create this pay group?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create pay group"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 409/)).toBeInTheDocument();
    });
  });
});
