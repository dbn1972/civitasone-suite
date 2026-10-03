import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { RegisterAssetForm } from "./RegisterAssetForm";

const CATS = [{ id: "22222222-2222-4222-8222-222222222222", code: "VEH", name: "Vehicles", depMethod: "WDV" as const, depRate: 15, usefulLifeYears: 8 }];

function fill() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jeep" } });
  fireEvent.change(screen.getByLabelText("Asset code"), { target: { value: "VEH/001" } });
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: CATS[0]!.id } });
  fireEvent.change(screen.getByLabelText("Acquisition cost (₹)"), { target: { value: "150.50" } });
}
async function submitThroughDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Register asset" }));
  await waitFor(() => expect(screen.getByText("Register this asset?")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Reason / authorisation"), { target: { value: "PO-77" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Register asset" }).at(-1)!);
}

describe("RegisterAssetForm ml-assets-05", () => {
  beforeEach(() => { push.mockReset(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  // GAP-ASSETS-REGISTER-06
  it("defaults the acquisition date to today in IST (not the UTC day) and posts a backdated choice", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-10T19:00:00Z")); // 00:30 IST on 11 March
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "a1" }), { status: 202 }));
    render(<RegisterAssetForm categories={CATS} />);
    const date = screen.getByLabelText("Acquisition date") as HTMLInputElement;
    expect(date.value).toBe("2026-03-11");
    expect(date.max).toBe("2026-03-11");
    fill();
    fireEvent.change(date, { target: { value: "2024-04-01" } });
    await submitThroughDialog();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)).toMatchObject({ acquisitionDate: "2024-04-01", acquisitionCost: 15050 });
  });

  it("rejects a future acquisition date", () => {
    render(<RegisterAssetForm categories={CATS} />);
    fill();
    fireEvent.change(screen.getByLabelText("Acquisition date"), { target: { value: "2999-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Register asset" }));
    expect(screen.getByText("Acquisition date cannot be in the future.")).toBeInTheDocument();
    expect(screen.queryByText("Register this asset?")).not.toBeInTheDocument();
  });

  // GAP-ASSETS-REGISTER-04
  it("shows plain-language error copy (no raw JSON) in an alert when the save fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "VALIDATION_FAILED", message: "ZodError: invalid_type at body.name", correlationId: "c-9" }), { status: 400 }));
    render(<RegisterAssetForm categories={CATS} />);
    fill();
    await submitThroughDialog();
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => /Some details weren't accepted. Check what you entered and try again./.test(a.textContent ?? ""))).toBe(true));
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/ZodError|VALIDATION_FAILED|correlationId|\{"code"/);
    expect(screen.queryByText(/submitted for registration/)).not.toBeInTheDocument();
  });

  it("a duplicate-code 409 is shown without raw text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "DUPLICATE_CODE", message: "asset code VEH/001 already exists" }), { status: 409 }));
    render(<RegisterAssetForm categories={CATS} />);
    fill();
    await submitThroughDialog();
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => /This code is already in use\. Choose a different code and try again\./.test(a.textContent ?? ""))).toBe(true));
    expect(document.body.textContent).not.toMatch(/DUPLICATE_CODE|already exists/);
  });

  // GAP-ASSETS-REGISTER-07
  it("keeps the submit button disabled after success and navigates immediately (no 600ms re-enable window)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "a1" }), { status: 202 }));
    render(<RegisterAssetForm categories={CATS} />);
    fill();
    await submitThroughDialog();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/assets/a1"));
    expect(screen.getByRole("button", { name: "Register asset" })).toBeDisabled();
  });
});
