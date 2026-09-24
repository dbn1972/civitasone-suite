import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreatePayGroupForm } from "./CreatePayGroupForm";

// UX-017: CreatePayGroupForm now reads its copy through next-intl
// (useTranslations("createPayGroupForm")), so every render needs a real
// provider in the tree -- same pattern as off-cycle/CreateOffCycleForm.test.tsx.
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreatePayGroupForm />
    </NextIntlClientProvider>,
  );
}

describe("CreatePayGroupForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a name before opening the confirm dialog", () => {
    renderForm();
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

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Weekly Wage Staff" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));

    await waitFor(() => expect(screen.getByText("Create this pay group?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create pay group"));

    await waitFor(() => {
      expect(screen.getByText(/Pay group "Weekly Wage Staff" created\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/status (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 409 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Duplicate Group" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));

    await waitFor(() => expect(screen.getByText("Create this pay group?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create pay group"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 409/)).not.toBeInTheDocument();
  });
});
