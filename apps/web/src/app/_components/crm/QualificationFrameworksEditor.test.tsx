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

  // Row identity (outer list): an unsaved framework fell back to
  // key={`new-${fi}`} (array position) since it has no id yet, so removing
  // an earlier unsaved framework shifted a later, focused one into the
  // removed framework's key -- React patched the focused DOM node in place
  // with a different framework's data instead of removing the right node
  // and leaving the rest (and focus) alone. A *saved* framework already
  // keys on its real id and isn't affected.
  it("keeps an unsaved framework's own value and focus attached to it after an earlier unsaved framework is removed", async () => {
    vi.mocked(lq.getFrameworks).mockResolvedValue({ data: [], source: "api" });
    render(<QualificationFrameworksEditor />);
    await waitFor(() => expect(screen.getByText(/no frameworks yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add framework/i }));
    fireEvent.click(screen.getByRole("button", { name: /add framework/i }));
    fireEvent.click(screen.getByRole("button", { name: /add framework/i }));

    const thirdName = screen.getAllByLabelText("Name")[2]!;
    fireEvent.change(thirdName, { target: { value: "MEDDPICC" } });
    thirdName.focus();
    expect(document.activeElement).toBe(thirdName);

    // Delete the first (unsaved) framework -- frameworks 2-3 shift up.
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /delete framework/i }));

    const survivingNames = await screen.findAllByLabelText("Name");
    expect(survivingNames[1]).toHaveValue("MEDDPICC");
    expect(document.activeElement).toBe(survivingNames[1]);
  });

  // Row identity (inner list): QualQuestion carries no id, so a framework's
  // question list was fully index-keyed -- same hazard, one level deeper.
  it("keeps a question's own value and focus attached to it after an earlier question is removed", async () => {
    vi.mocked(lq.getFrameworks).mockResolvedValue({ data: [fw], source: "api" });
    render(<QualificationFrameworksEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("BANT")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add question/i }));
    fireEvent.click(screen.getByRole("button", { name: /add question/i }));
    // fw already has 1 question ("Has budget?"), plus 2 new blank ones = 3.

    const thirdQuestion = screen.getAllByLabelText(/question \d text/i)[2]!;
    fireEvent.change(thirdQuestion, { target: { value: "Has authority?" } });
    thirdQuestion.focus();
    expect(document.activeElement).toBe(thirdQuestion);

    // Remove the first question -- questions 2-3 shift up to become 1-2.
    fireEvent.click(screen.getAllByRole("button", { name: /remove question/i })[0]!);

    const survivingThirdQuestion = screen.getAllByLabelText(/question \d text/i)[1]!;
    expect(survivingThirdQuestion).toHaveValue("Has authority?");
    expect(document.activeElement).toBe(survivingThirdQuestion);
  });
});
