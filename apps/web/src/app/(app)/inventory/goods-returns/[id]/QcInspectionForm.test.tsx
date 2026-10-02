import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock("@/app/_components/ds", async () => {
  const actual = await vi.importActual<typeof import("@/app/_components/ds")>("@/app/_components/ds");
  return { ...actual, useToast: () => ({ toast }) };
});

const { QcInspectionForm } = await import("./QcInspectionForm");
const { allowedDispositions, isDispositionAllowed, dispositionLabel } = await import("./qcMatrix");

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
});

const optionValues = () => Array.from(document.querySelectorAll("select option")).map((o) => (o as HTMLOptionElement).value);
const confirmButton = () =>
  Array.from(screen.getByRole("alertdialog").querySelectorAll("button")).find((b) => b.textContent === "Record verdict") as HTMLButtonElement;
const record = () => screen.getByRole("button", { name: "Record verdict" });

describe("qcMatrix (GAP-INVENTORY-GOODS-RETURNS-DETAIL-01 / -02)", () => {
  it("never allows failed->restock or passed->scrap", () => {
    expect(isDispositionAllowed("failed", "restock")).toBe(false);
    expect(isDispositionAllowed("passed", "scrap")).toBe(false);
    expect(allowedDispositions("failed")).toEqual(["quarantine", "scrap"]);
    expect(allowedDispositions("passed")).toEqual(["restock"]);
  });
  it("labels say exactly what is stored, with no vendor-return or penalty wording", () => {
    for (const v of ["restock", "quarantine", "scrap"]) {
      expect(dispositionLabel(v)).not.toMatch(/vendor|penalty/i);
    }
    expect(dispositionLabel("restock")).toBe("Restock to stock");
  });
});

describe("QcInspectionForm", () => {
  it("Fail offers no restock option, and the body never carries failed+restock", async () => {
    render(<QcInspectionForm goodsReturnId="gr-1" qty={3} itemName="Toner" />);
    fireEvent.click(screen.getByLabelText("Fail"));
    expect(optionValues()).not.toContain("restock");
    expect(optionValues()).toEqual(expect.arrayContaining(["quarantine", "scrap"]));
    fireEvent.change(screen.getByLabelText(/^Disposition/), { target: { value: "scrap" } });
    fireEvent.change(screen.getByLabelText(/Inspector notes/), { target: { value: "water damaged, unusable" } });
    fireEvent.click(record());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ qcStatus: "failed", disposition: "scrap", qcNotes: "water damaged, unusable" });
  });

  it("switching Fail->Pass resets a now-invalid disposition (and preselects the only valid one)", () => {
    render(<QcInspectionForm goodsReturnId="gr-1" />);
    fireEvent.click(screen.getByLabelText("Fail"));
    fireEvent.change(screen.getByLabelText(/^Disposition/), { target: { value: "scrap" } });
    fireEvent.click(screen.getByLabelText("Pass"));
    expect((screen.getByLabelText(/^Disposition/) as HTMLSelectElement).value).toBe("restock");
    fireEvent.click(screen.getByLabelText("Fail"));
    expect((screen.getByLabelText(/^Disposition/) as HTMLSelectElement).value).toBe("");
  });

  it("Record verdict is disabled until a verdict and disposition are chosen, and notes are mandatory for a failure", () => {
    render(<QcInspectionForm goodsReturnId="gr-1" />);
    expect(record()).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Fail"));
    fireEvent.change(screen.getByLabelText(/^Disposition/), { target: { value: "quarantine" } });
    expect(record()).toBeDisabled(); // notes missing
    fireEvent.change(screen.getByLabelText(/Inspector notes/), { target: { value: "cracked casing seen" } });
    expect(record()).toBeEnabled();
  });

  it("Pass needs no notes, opens a confirmation, and Cancel sends nothing", () => {
    render(<QcInspectionForm goodsReturnId="gr-1" qty={12} itemName="Toner" />);
    fireEvent.click(screen.getByLabelText("Pass"));
    expect(record()).toBeEnabled();
    fireEvent.click(record());
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Record PASS and restock 12 units of Toner?");
    fireEvent.click(Array.from(screen.getByRole("alertdialog").querySelectorAll("button")).find((b) => b.textContent === "Cancel")!);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a successful confirm toasts and refreshes", async () => {
    render(<QcInspectionForm goodsReturnId="gr-1" />);
    fireEvent.click(screen.getByLabelText("Pass"));
    fireEvent.click(record());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("QC verdict recorded."));
    expect(refresh).toHaveBeenCalled();
  });
});
