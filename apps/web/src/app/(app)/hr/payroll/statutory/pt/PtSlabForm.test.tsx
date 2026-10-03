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

  it("GAP-PAYROLL-STATUTORY-PT-03: explains an overlapping slab (422 PT_SLAB_OVERLAP) and states upsert semantics", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "PT_SLAB_OVERLAP", message: "slab 0-1 overlaps" }), { status: 422 }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "KA" } });
    fireEvent.change(screen.getByLabelText(/PT Amount/), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save PT Slab" }));

    await waitFor(() => expect(screen.getByText("Save this professional tax slab?")).toBeInTheDocument());
    expect(screen.getByText(/the state's other slabs are kept/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => {
      expect(screen.getByText(/This range overlaps another slab for this state/)).toBeInTheDocument();
    });
  });

  // GAP-PAYROLL-STATUTORY-PT-04: the client pre-check must agree EXACTLY with
  // payroll-service's findPtSlabOverlap / ptSlab refine (state-rules.ts):
  // inclusive ranges, From == To allowed, same-From slab = upsert target.
  describe("client pre-check mirrors the server PT slab rule (GAP-PAYROLL-STATUTORY-PT-04)", () => {
    const existing = [{ state_code: "KA", slab_from_minor: 0, slab_to_minor: 1500000 }];
    function fill(state: string, from: string, to: string) {
      render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <PtSlabForm existingSlabs={existing} />
        </NextIntlClientProvider>,
      );
      fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: state } });
      fireEvent.change(screen.getByLabelText(/Slab From/), { target: { value: from } });
      fireEvent.change(screen.getByLabelText(/Slab To/), { target: { value: to } });
      fireEvent.change(screen.getByLabelText(/PT Amount/), { target: { value: "200" } });
      fireEvent.click(screen.getByRole("button", { name: "Save PT Slab" }));
    }

    it("rejects a slab that only touches an existing slab's upper bound (ranges are inclusive)", () => {
      fill("KA", "15000", "20000");
      expect(screen.getByText("This slab overlaps an existing slab for this state.")).toBeInTheDocument();
      expect(screen.queryByText("Save this professional tax slab?")).not.toBeInTheDocument();
    });

    it("accepts the next slab starting one paisa above the existing upper bound", async () => {
      fill("KA", "15000.01", "20000");
      await waitFor(() => expect(screen.getByText("Save this professional tax slab?")).toBeInTheDocument());
    });

    it("treats an existing slab with the same From as the upsert target, not an overlap", async () => {
      fill("KA", "0", "10000");
      await waitFor(() => expect(screen.getByText("Save this professional tax slab?")).toBeInTheDocument());
    });

    it("ignores slabs of other states", async () => {
      fill("MH", "100", "20000");
      await waitFor(() => expect(screen.getByText("Save this professional tax slab?")).toBeInTheDocument());
    });

    it("allows a single-amount slab where From == To (server: toMinor >= fromMinor)", async () => {
      fill("MH", "500", "500");
      await waitFor(() => expect(screen.getByText("Save this professional tax slab?")).toBeInTheDocument());
    });

    it("rejects To below From", () => {
      fill("MH", "600", "500");
      expect(screen.getByText("Slab 'To' cannot be less than slab 'From'.")).toBeInTheDocument();
    });
  });

  // fin-payroll-03 (GAP-PAYROLL-STATUTORY-PT-04/06)
  describe("state picker, effective date and error mapping", () => {
    it("offers a state / UT picker (no free text) that includes KA and MH", () => {
      renderForm();
      const select = screen.getByLabelText(/State Code/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const values = Array.from(select.options).map((o) => o.value);
      expect(values).toContain("KA");
      expect(values).toContain("MH");
      expect(values).not.toContain("ZZ");
    });

    it("states beside the date field, and again in the confirm dialog, that the date does not defer the change", async () => {
      renderForm();
      const note = "Saving replaces this slab immediately for all runs not yet computed; the date is recorded and does not defer the change.";
      expect(screen.getByLabelText("Effective from")).toHaveAccessibleDescription(note);
      fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "KA" } });
      fireEvent.change(screen.getByLabelText(/PT Amount/), { target: { value: "200" } });
      fireEvent.click(screen.getByRole("button", { name: "Save PT Slab" }));
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveTextContent(note);
    });

    it("sends the Effective from date (default today) with the slab", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
      renderForm();
      fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "KA" } });
      fireEvent.change(screen.getByLabelText(/PT Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "2026-04-01" } });
      fireEvent.click(screen.getByRole("button", { name: "Save PT Slab" }));
      await waitFor(() => expect(screen.getByText("Save this professional tax slab?")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Confirm & Save"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
      expect(body.effectiveFrom).toBe("2026-04-01");
      expect(body.stateCode).toBe("KA");
    });

    it("warns (without blocking) when the slab leaves a gap in the state's chain", async () => {
      render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <PtSlabForm existingSlabs={[{ state_code: "KA", slab_from_minor: 0, slab_to_minor: 1500000 }]} />
        </NextIntlClientProvider>,
      );
      fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "KA" } });
      fireEvent.change(screen.getByLabelText(/Slab From/), { target: { value: "20000" } });
      fireEvent.change(screen.getByLabelText(/PT Amount/), { target: { value: "200" } });
      fireEvent.click(screen.getByRole("button", { name: "Save PT Slab" }));
      await waitFor(() => expect(screen.getByText("Save this professional tax slab?")).toBeInTheDocument());
      expect(screen.getByText(/leaves a gap in the state's slab chain/)).toBeInTheDocument();
    });

    it("PT-06: a 403 on save reads as a permission problem, not the generic save failure", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN", message: "requires one of: payroll_admin" }), { status: 403 }));
      renderForm();
      fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "KA" } });
      fireEvent.change(screen.getByLabelText(/PT Amount/), { target: { value: "200" } });
      fireEvent.click(screen.getByRole("button", { name: "Save PT Slab" }));
      await waitFor(() => expect(screen.getByText("Save this professional tax slab?")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Confirm & Save"));
      await waitFor(() => expect(screen.getByText(/don't have permission/i)).toBeInTheDocument());
      expect(screen.queryByText(/payroll_admin/)).not.toBeInTheDocument();
    });

    it("PT-06: other failures name the area ('your professional tax slab')", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
      renderForm();
      fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "KA" } });
      fireEvent.change(screen.getByLabelText(/PT Amount/), { target: { value: "200" } });
      fireEvent.click(screen.getByRole("button", { name: "Save PT Slab" }));
      await waitFor(() => expect(screen.getByText("Save this professional tax slab?")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Confirm & Save"));
      await waitFor(() => expect(screen.getByText(/couldn't save your professional tax slab/i)).toBeInTheDocument());
    });
  });
});
