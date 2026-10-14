import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const browserJsonMock = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({
  browserJson: (...args: unknown[]) => browserJsonMock(...args),
}));
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { UserFacingError } from "@/lib/userFacingError";

// The departments an org unit can be picked from (enrolled operator divisions).
const depts = vi.hoisted(() => ({ value: { loaded: true, failed: false, divisions: ["ADMIN", "Finance"] as string[] } }));
vi.mock("@/lib/estab/useEstabDivisions", () => ({ useEstabDivisions: () => depts.value }));

import { QuarterCreateForm } from "./QuarterCreateForm";

describe("QuarterCreateForm", () => {
  beforeEach(() => {
    browserJsonMock.mockReset();
    refreshMock.mockReset();
    depts.value = { loaded: true, failed: false, divisions: ["ADMIN", "Finance"] };
  });

  it("submits a new quarter on confirm (happy path)", async () => {
    browserJsonMock.mockResolvedValue({ status: "accepted" });
    render(<QuarterCreateForm />);

    fireEvent.change(screen.getByLabelText(/Quarter No\./), { target: { value: "B-14" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Quarter" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add quarter" }));

    await waitFor(() => expect(browserJsonMock).toHaveBeenCalledWith(
      "v1/estab/quarters",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText(/submitted to the inventory\. It appears in the list once it is processed/)).toBeInTheDocument();
  });

  it("blocks submission and shows a field error when quarter number is missing", () => {
    render(<QuarterCreateForm />);
    fireEvent.click(screen.getByRole("button", { name: "Add Quarter" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter the quarter number.");
    expect(browserJsonMock).not.toHaveBeenCalled();
  });

  it("shows a user-safe server message in the confirm dialog on failure", async () => {
    browserJsonMock.mockRejectedValue(new UserFacingError("That quarter number is already in use. Choose a different one."));
    render(<QuarterCreateForm />);

    fireEvent.change(screen.getByLabelText(/Quarter No\./), { target: { value: "B-14" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Quarter" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add quarter" }));

    expect(await screen.findByText("That quarter number is already in use. Choose a different one.")).toBeInTheDocument();
  });

  it("never shows the raw text of an unexpected error in the confirm dialog", async () => {
    browserJsonMock.mockRejectedValue(new Error("VALIDATION: quarterNo already exists (pg 23505)"));
    render(<QuarterCreateForm />);

    fireEvent.change(screen.getByLabelText(/Quarter No\./), { target: { value: "B-14" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Quarter" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add quarter" }));

    await screen.findByRole("alert");
    expect(document.body.textContent).not.toMatch(/23505|VALIDATION: quarterNo/);
  });

  it("GAP-ESTAB-QUARTERS-04: the org unit is a pick-list of real departments, not free text, and the chosen one is posted", async () => {
    browserJsonMock.mockResolvedValue({ status: "accepted" });
    render(<QuarterCreateForm />);
    const org = screen.getByLabelText("Org Unit") as HTMLSelectElement;
    expect(org.tagName).toBe("SELECT");
    expect(Array.from(org.options).map((o) => o.value)).toEqual(["", "ADMIN", "Finance"]);

    fireEvent.change(screen.getByLabelText(/Quarter No\./), { target: { value: "B-14" } });
    fireEvent.change(org, { target: { value: "Finance" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Quarter" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add quarter" }));
    await waitFor(() => expect(browserJsonMock).toHaveBeenCalled());
    const body = JSON.parse((browserJsonMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.orgUnit).toBe("Finance");
  });

  it("GAP-ESTAB-QUARTERS-04: org unit is optional; left unselected it is not sent", async () => {
    browserJsonMock.mockResolvedValue({ status: "accepted" });
    render(<QuarterCreateForm />);
    fireEvent.change(screen.getByLabelText(/Quarter No\./), { target: { value: "B-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Quarter" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add quarter" }));
    await waitFor(() => expect(browserJsonMock).toHaveBeenCalled());
    const body = JSON.parse((browserJsonMock.mock.calls[0]![1] as RequestInit).body as string);
    expect("orgUnit" in body && body.orgUnit !== undefined).toBe(false);
  });

  it("GAP-ESTAB-QUARTERS-04: with no departments the org unit is an enabled typed field and says why", () => {
    depts.value = { loaded: true, failed: false, divisions: [] };
    render(<QuarterCreateForm />);
    const orgUnit = screen.getByLabelText("Org Unit") as HTMLInputElement;
    expect(orgUnit.tagName).toBe("INPUT");
    expect(orgUnit.disabled).toBe(false);
    expect(screen.getByRole("note").textContent).toMatch(/No department list is available/i);
  });

  it("GAP-ESTAB-QUARTERS-05: no hard-coded hex colour fallback in the form", () => {
    const { container } = render(<QuarterCreateForm />);
    fireEvent.click(screen.getByRole("button", { name: "Add Quarter" }));
    expect(container.innerHTML).not.toMatch(/#c0392b/i);
  });
});
