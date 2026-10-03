import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { RegisterAssetForm } from "./RegisterAssetForm";

const CATS = [
  { id: "11111111-1111-4111-8111-111111111111", code: "IT", name: "IT equipment", depMethod: "SLM" as const, depRate: 33.33, usefulLifeYears: 3 },
  { id: "22222222-2222-4222-8222-222222222222", code: "VEH", name: "Vehicles", depMethod: "WDV" as const, depRate: 15, usefulLifeYears: 8 },
];

function fill() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jeep" } });
  fireEvent.change(screen.getByLabelText("Asset code"), { target: { value: "VEH/001" } });
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: CATS[1]!.id } });
  fireEvent.change(screen.getByLabelText("Acquisition cost (₹)"), { target: { value: "850000.50" } });
}

describe("RegisterAssetForm", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  // GAP-ASSETS-REGISTER-01
  it("opens a confirm dialog (no request) and keeps Confirm disabled until a reason is given", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<RegisterAssetForm categories={CATS} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Register asset" }));
    await waitFor(() => expect(screen.getByText("Register this asset?")).toBeInTheDocument());
    expect(screen.getByText("₹8,50,000.50")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    const confirm = screen.getAllByRole("button", { name: "Register asset" }).at(-1)!;
    expect(confirm).toBeDisabled();
  });

  // GAP-ASSETS-REGISTER-02
  it("cannot submit without a category, and posts the chosen category with its depreciation terms", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "x" }), { status: 202 }));
    render(<RegisterAssetForm categories={CATS} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jeep" } });
    fireEvent.change(screen.getByLabelText("Asset code"), { target: { value: "VEH/001" } });
    fireEvent.change(screen.getByLabelText("Acquisition cost (₹)"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Register asset" }));
    expect(screen.getByText("Choose a category.")).toBeInTheDocument();
    expect(screen.queryByText("Register this asset?")).not.toBeInTheDocument();

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Register asset" }));
    await waitFor(() => expect(screen.getByText("Register this asset?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason / authorisation"), { target: { value: "Purchase order PO-77" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Register asset" }).at(-1)!);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({
      categoryId: CATS[1]!.id, depMethod: "WDV", depRate: 15, usefulLifeYears: 8,
      code: "VEH/001", acquisitionCost: 85000050, notes: "Purchase order PO-77",
    });
  });

  // GAP-ASSETS-REGISTER-03
  // GAP-ASSETS-LOCATIONS-03
  describe("location", () => {
    const LOCS = [
      { id: "aaaaaaaa-0000-4000-8000-000000000001", code: "BLK-A", name: "Block A", parentId: null },
      { id: "aaaaaaaa-0000-4000-8000-000000000002", code: "BLK-A-1", name: "Floor 1", parentId: "aaaaaaaa-0000-4000-8000-000000000001" },
    ];

    it("offers the registered locations nested, and posts the chosen locationId (no free-text location)", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "x" }), { status: 202 }));
      render(<RegisterAssetForm categories={CATS} locations={LOCS} />);
      const select = screen.getByLabelText("Location") as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      expect(screen.getByRole("option", { name: "BLK-A · Block A" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "— BLK-A-1 · Floor 1" })).toBeInTheDocument();
      fill();
      fireEvent.change(select, { target: { value: LOCS[1]!.id } });
      fireEvent.click(screen.getByRole("button", { name: "Register asset" }));
      await waitFor(() => expect(screen.getByText("Register this asset?")).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText("Reason / authorisation"), { target: { value: "PO-1" } });
      fireEvent.click(screen.getAllByRole("button", { name: "Register asset" }).at(-1)!);
      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.locationId).toBe(LOCS[1]!.id);
      expect(body.location).toBeUndefined();
    });

    it("falls back to a free-text location when none are registered, and says so when the list failed to load", () => {
      const { rerender } = render(<RegisterAssetForm categories={CATS} locations={[]} />);
      expect((screen.getByLabelText("Location") as HTMLElement).tagName).toBe("INPUT");
      expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
      rerender(<RegisterAssetForm categories={CATS} locations={[]} locationsFailed />);
      expect(screen.getByText(/location list could not be loaded/)).toBeInTheDocument();
    });
  });

  it("requires an asset code instead of inventing one", () => {
    render(<RegisterAssetForm categories={CATS} />);
    fill();
    fireEvent.change(screen.getByLabelText("Asset code"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Register asset" }));
    expect(screen.getByText("Enter the asset code.")).toBeInTheDocument();
  });

  it("has no hard-coded category id or Math.random in the register screen", () => {
    for (const f of ["page.tsx", "RegisterAssetForm.tsx"]) {
      const src = readFileSync(join(__dirname, f), "utf8");
      expect(src).not.toMatch(/77777777-0001/);
      expect(src).not.toMatch(/Math\.random/);
    }
  });

  it("rejects a zero or out-of-range acquisition cost", () => {
    render(<RegisterAssetForm categories={CATS} />);
    fill();
    fireEvent.change(screen.getByLabelText("Acquisition cost (₹)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Register asset" }));
    expect(screen.getByText(/greater than zero/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Acquisition cost (₹)"), { target: { value: "999999999999999999" } });
    fireEvent.click(screen.getByRole("button", { name: "Register asset" }));
    expect(screen.queryByText("Register this asset?")).not.toBeInTheDocument();
  });
});
