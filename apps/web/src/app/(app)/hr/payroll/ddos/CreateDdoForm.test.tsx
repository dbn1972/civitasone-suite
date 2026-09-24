import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateDdoForm } from "./CreateDdoForm";

// UX-017: CreateDdoForm now reads its copy through next-intl
// (useTranslations("createDdoForm")), so every render needs a real
// provider in the tree -- same pattern as off-cycle/CreateOffCycleForm.test.tsx.
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreateDdoForm />
    </NextIntlClientProvider>,
  );
}

describe("CreateDdoForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires DDO code and name before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByText("Save DDO"));
    expect(screen.getByText("DDO code and name are required.")).toBeInTheDocument();
  });

  it("saves a DDO on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ddoCode: "DDO02", name: "New DDO", departmentIds: [] }), { status: 201 }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/DDO Code/), { target: { value: "DDO02" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "New DDO" } });
    fireEvent.click(screen.getByText("Save DDO"));

    await waitFor(() => expect(screen.getByText("Save this DDO?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm save"));

    await waitFor(() => {
      expect(screen.getByText(/DDO02 — New DDO saved/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/DDO Code/), { target: { value: "DDO03" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Another DDO" } });
    fireEvent.click(screen.getByText("Save DDO"));

    await waitFor(() => expect(screen.getByText("Save this DDO?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm save"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });
});
