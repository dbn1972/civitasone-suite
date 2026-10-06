import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateProjectForm, type SchemeOption } from "./CreateProjectForm";

const SCHEMES: SchemeOption[] = [
  { id: "11111111-1111-1111-1111-111111111111", schemeCode: "SCH-1", name: "Rural Roads" },
];

function fillRequired() {
  fireEvent.change(screen.getByLabelText("Project code *"), { target: { value: "PRJ-1" } });
  fireEvent.change(screen.getByLabelText("Project name *"), { target: { value: "Test Project" } });
}

describe("CreateProjectForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ id: "p1" }), { status: 202 }))));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // GAP-PROJECTS-NEW-02
  it("shows per-field errors under code and name and focuses the first invalid field on empty submit", () => {
    render(<CreateProjectForm schemes={SCHEMES} />);
    fireEvent.click(screen.getByRole("button", { name: /create project/i }));

    expect(screen.getByText("Project code is required.")).toBeInTheDocument();
    expect(screen.getByText("Project name is required.")).toBeInTheDocument();

    const codeInput = screen.getByLabelText("Project code *");
    expect(codeInput).toHaveAttribute("aria-invalid", "true");
    expect(codeInput).toHaveAttribute("aria-describedby", "code-err");
    expect(document.activeElement).toBe(codeInput);
  });

  // GAP-PROJECTS-NEW-04
  it("rejects an amount with more than 2 decimal places (e.g. 1.005)", () => {
    render(<CreateProjectForm schemes={SCHEMES} />);
    fillRequired();
    fireEvent.change(screen.getByLabelText("Sanctioned amount (₹)"), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: /create project/i }));

    expect(screen.getByText(/valid amount in rupees/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // GAP-PROJECTS-NEW-04
  it("echoes the formatted money (₹50,00,000.00) for input 5000000", () => {
    render(<CreateProjectForm schemes={SCHEMES} />);
    fireEvent.change(screen.getByLabelText("Sanctioned amount (₹)"), { target: { value: "5000000" } });
    expect(screen.getByText("₹50,00,000.00")).toBeInTheDocument();
  });

  it("uses a text input with decimal input mode (not type=number)", () => {
    render(<CreateProjectForm schemes={SCHEMES} />);
    const input = screen.getByLabelText("Sanctioned amount (₹)");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputMode", "decimal");
  });

  // GAP-PROJECTS-NEW-01
  it("offers a scheme picker and sends schemeId + agencyRef + correct paise in the POST body", async () => {
    render(<CreateProjectForm schemes={SCHEMES} />);
    fillRequired();
    fireEvent.change(screen.getByLabelText("Scheme"), { target: { value: SCHEMES[0].id } });
    fireEvent.change(screen.getByLabelText("Implementing agency / department"), { target: { value: "PWD" } });
    fireEvent.change(screen.getByLabelText("Sanctioned amount (₹)"), { target: { value: "5000000" } });

    // Submit the form (submit button, type=submit).
    const submitBtn = screen.getAllByRole("button", { name: /create project/i }).find(
      (b) => b.getAttribute("type") === "submit",
    );
    fireEvent.click(submitBtn!);
    // confirm dialog -> click the dialog's confirm button (type=button),
    // distinct from the form's submit button (type=submit).
    const confirmBtn = screen.getAllByRole("button", { name: /create project/i }).find(
      (b) => b.getAttribute("type") === "button",
    );
    expect(confirmBtn).toBeDefined();
    fireEvent.click(confirmBtn!);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.schemeId).toBe(SCHEMES[0].id);
    expect(body.agencyRef).toBe("PWD");
    expect(body.sanctionedMinor).toBe(500000000); // 5,000,000 rupees -> paise, no float drift
    expect(typeof body.sanctionedMinor).toBe("number");
  });
});
