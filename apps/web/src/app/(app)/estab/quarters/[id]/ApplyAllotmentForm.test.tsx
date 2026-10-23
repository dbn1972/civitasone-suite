import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const EMP = "44444444-4444-4444-8444-444444444444";
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: vi.fn(async () => []),
  resolveEmployees: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, label: "Kiran Bose (E-104)" }))),
}));
vi.mock("@/app/_components/ds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/_components/ds")>();
  return {
    ...actual,
    EntityPicker: ({ onChange }: { onChange: (v: string | null) => void }) => (
      <button type="button" onClick={() => onChange(EMP)}>pick employee</button>
    ),
  };
});
const browserJsonMock = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({ browserJson: (...a: unknown[]) => browserJsonMock(...a) }));

import { ApplyAllotmentForm } from "./ApplyAllotmentForm";

describe("ApplyAllotmentForm — GAP-ESTAB-QUARTERS-DETAIL-02", () => {
  beforeEach(() => { browserJsonMock.mockReset(); });

  it("Given an employee is picked, Then the confirmation names them and states the designation / pay level that will be recorded, with no id", async () => {
    render(<ApplyAllotmentForm quarterId="q1" />);
    fireEvent.click(screen.getByText("pick employee"));
    fireEvent.change(screen.getByLabelText(/Designation/), { target: { value: "Section Officer" } });
    fireEvent.change(screen.getByLabelText(/Pay level/i), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply for allotment" }));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog.textContent).toContain("Kiran Bose"));
    expect(dialog.textContent).toContain("Section Officer");
    expect(dialog.textContent).toContain("pay level: 8");
    expect(dialog.textContent).not.toContain("44444444");
    expect(dialog.textContent).not.toContain("the selected employee");
  });

  it("Given no employee is picked, Then submit is refused with an error and no dialog", () => {
    render(<ApplyAllotmentForm quarterId="q1" />);
    fireEvent.click(screen.getByRole("button", { name: "Apply for allotment" }));
    expect(screen.getByText("Select the applying employee.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Given the request fails with a raw error, Then the dialog shows generic copy, never the raw message", async () => {
    browserJsonMock.mockImplementation(async () => { throw new Error("pq: duplicate key value violates unique constraint estab_qa_uq"); });
    render(<ApplyAllotmentForm quarterId="q1" />);
    fireEvent.click(screen.getByText("pick employee"));
    fireEvent.click(screen.getByRole("button", { name: "Apply for allotment" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Submit application")!);
    expect(await screen.findByText(/could not be completed/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("duplicate key");
  });

  it.each(["1e2", "12.9", "3x", "-1"])("CLOS2-S1-06: seniority %s is rejected, not silently truncated, and blocks submit", (bad) => {
    render(<ApplyAllotmentForm quarterId="q1" />);
    fireEvent.click(screen.getByText("pick employee"));
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: bad } });
    fireEvent.click(screen.getByRole("button", { name: "Apply for allotment" }));
    expect(screen.getByText("Seniority (months) must be zero or a positive whole number.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(browserJsonMock).not.toHaveBeenCalled();
  });

  it("CLOS2-S1-06: seniority 12 is submitted as 12", async () => {
    browserJsonMock.mockResolvedValue({ status: "accepted" });
    render(<ApplyAllotmentForm quarterId="q1" />);
    fireEvent.click(screen.getByText("pick employee"));
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply for allotment" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Submit application")!);
    await waitFor(() => expect(browserJsonMock).toHaveBeenCalled());
    expect(JSON.parse((browserJsonMock.mock.calls[0][1] as { body: string }).body).seniorityMonths).toBe(12);
  });
});
