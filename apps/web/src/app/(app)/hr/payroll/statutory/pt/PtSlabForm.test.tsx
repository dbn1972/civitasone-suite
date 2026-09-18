import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { PtSlabForm } from "./PtSlabForm";

// UX-017: PtSlabForm now reads its copy through next-intl
// (useTranslations("ptSlabForm")), so every render needs a real provider in
// the tree -- same pattern as corrections/CreateCorrectionForm.test.tsx
// (tranche 11).
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PtSlabForm />
    </NextIntlClientProvider>,
  );
}

describe("PtSlabForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a state code before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Save PT Slab" }));
    expect(screen.getByText("State code is required.")).toBeInTheDocument();
  });

  it("saves a PT slab on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { stateCode: "KA", saved: true } }), { status: 201 }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "KA" } });
    fireEvent.change(screen.getByLabelText(/PT Amount/), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save PT Slab" }));

    await waitFor(() => expect(screen.getByText("Save this professional tax slab?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => {
      expect(screen.getByText(/Professional tax slab saved for KA\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/status (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "KA" } });
    fireEvent.change(screen.getByLabelText(/PT Amount/), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save PT Slab" }));

    await waitFor(() => expect(screen.getByText("Save this professional tax slab?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 500/)).not.toBeInTheDocument();
  });
});
