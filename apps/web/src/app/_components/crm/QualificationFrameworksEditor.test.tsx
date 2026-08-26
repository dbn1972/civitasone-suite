import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QualificationFrameworksEditor } from "./QualificationFrameworksEditor";
import * as lq from "@/lib/crm/leadQualification";

vi.mock("@/lib/crm/leadQualification", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/leadQualification")>();
  return {
    ...actual,
    getFrameworks: vi.fn(),
    createFramework: vi.fn(),
    updateFramework: vi.fn(),
    deleteFramework: vi.fn(),
  };
});

const fw: lq.QualificationFramework = {
  id: "f1", name: "BANT", businessLine: "government", active: true,
  questions: [{ id: "q1", text: "Has budget?", weight: 2 }],
};

beforeEach(() => {
  vi.mocked(lq.getFrameworks).mockReset();
  vi.mocked(lq.createFramework).mockReset();
  vi.mocked(lq.updateFramework).mockReset();
  vi.mocked(lq.deleteFramework).mockReset();
});

describe("QualificationFrameworksEditor (LQ-001 admin)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(lq.getFrameworks).mockResolvedValue({ data: [], source: "error" });
    render(<QualificationFrameworksEditor />);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
    expect(screen.getByText(/no frameworks yet/i)).toBeInTheDocument();
  });

  it("adds a new framework, requires name + business line, then creates it", async () => {
    vi.mocked(lq.getFrameworks).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(lq.createFramework).mockResolvedValue(undefined);
    render(<QualificationFrameworksEditor />);
    await waitFor(() => expect(screen.getByText(/no frameworks yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add framework/i }));

    // Save without a name → validation error, no create call.
    fireEvent.click(screen.getByRole("button", { name: /save framework/i }));
    expect(await screen.findByText(/needs a name and a business line/i)).toBeInTheDocument();
    expect(lq.createFramework).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "MEDDIC" } });
    fireEvent.change(screen.getByLabelText("Business line"), { target: { value: "psu" } });
    fireEvent.click(screen.getByRole("button", { name: /save framework/i }));
    await waitFor(() => expect(lq.createFramework).toHaveBeenCalled());
    expect(vi.mocked(lq.createFramework).mock.calls[0][0]).toMatchObject({ name: "MEDDIC", businessLine: "psu" });
  });

  it("adds a question to a loaded framework and saves via update", async () => {
    vi.mocked(lq.getFrameworks).mockResolvedValue({ data: [fw], source: "api" });
    vi.mocked(lq.updateFramework).mockResolvedValue(undefined);
    render(<QualificationFrameworksEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("BANT")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add question/i }));
    fireEvent.click(screen.getByRole("button", { name: /save framework/i }));
    await waitFor(() => expect(lq.updateFramework).toHaveBeenCalledWith("f1", expect.objectContaining({ id: "f1" })));
    expect(vi.mocked(lq.updateFramework).mock.calls[0][1].questions.length).toBe(2);
  });

  it("deletes a saved framework after ConfirmDialog confirmation", async () => {
    vi.mocked(lq.getFrameworks).mockResolvedValue({ data: [fw], source: "api" });
    vi.mocked(lq.deleteFramework).mockResolvedValue(undefined);
    render(<QualificationFrameworksEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("BANT")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /delete framework/i }));
    await waitFor(() => expect(lq.deleteFramework).toHaveBeenCalledWith("f1"));
  });
});
