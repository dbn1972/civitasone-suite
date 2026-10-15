import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl as render } from "@/lib/testUtils/intl";
import { ComplianceTable, type ComplianceRow } from "./ComplianceTable";

// Mock next/navigation router.refresh
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const ROWS: ComplianceRow[] = [
  { id: "c1", title: "Submit RTI annual report", category: "RTI", assignedTo: "S. Sharma", due: "01/10/2026", status: "Pending", statusRaw: "pending" },
  { id: "c2", title: "Fire safety inspection", category: "Safety", assignedTo: null, due: "15/09/2026", status: "Overdue", statusRaw: "overdue" },
  { id: "c3", title: "Statutory audit filing", category: "Audit", assignedTo: "R. Kumar", due: "01/08/2026", status: "Complied", statusRaw: "complied" },
];

describe("ComplianceTable — GAP-ESTAB-COMPLIANCE-05 (filter segments)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders All / Open / Overdue / Complied segments", () => {
    render(<ComplianceTable canComply rows={ROWS} />);
    expect(screen.getByRole("tab", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overdue" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Complied" })).toBeInTheDocument();
  });

  it("Open segment shows only pending rows", () => {
    render(<ComplianceTable canComply rows={ROWS} />);
    fireEvent.click(screen.getByRole("tab", { name: "Open" }));
    expect(screen.getByText("Submit RTI annual report")).toBeInTheDocument();
    expect(screen.queryByText("Fire safety inspection")).not.toBeInTheDocument();
    expect(screen.queryByText("Statutory audit filing")).not.toBeInTheDocument();
  });

  it("Overdue segment shows only overdue rows", () => {
    render(<ComplianceTable canComply rows={ROWS} />);
    fireEvent.click(screen.getByRole("tab", { name: "Overdue" }));
    expect(screen.getByText("Fire safety inspection")).toBeInTheDocument();
    expect(screen.queryByText("Submit RTI annual report")).not.toBeInTheDocument();
  });
});

describe("ComplianceTable — GAP-ESTAB-COMPLIANCE-04 (assignedTo null display)", () => {
  it("shows '—' when assignedTo is null", () => {
    render(<ComplianceTable canComply rows={ROWS} />);
    // The overdue row (c2) has assignedTo: null
    const cells = screen.getAllByRole("cell");
    const assignedCells = cells.filter((c) => c.textContent === "—");
    expect(assignedCells.length).toBeGreaterThanOrEqual(1);
  });

  it("shows name when assignedTo is present", () => {
    render(<ComplianceTable canComply rows={ROWS} />);
    expect(screen.getByText("S. Sharma")).toBeInTheDocument();
  });
});

describe("ComplianceTable — GAP-ESTAB-COMPLIANCE-03 (mark complied)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows 'Mark complied' button for non-complied rows", () => {
    render(<ComplianceTable canComply rows={ROWS} />);
    // 2 non-complied rows (pending + overdue) should have the button
    const buttons = screen.getAllByRole("button", { name: /mark complied/i });
    expect(buttons).toHaveLength(2);
  });

  it("does not show 'Mark complied' button for already-complied rows", () => {
    render(<ComplianceTable canComply rows={[ROWS[2]]} />); // only the complied row
    expect(screen.queryByRole("button", { name: /mark complied/i })).not.toBeInTheDocument();
  });

  it("calls POST comply endpoint when confirmed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "c1", status: "accepted" }), { status: 202 }),
    );
    render(<ComplianceTable canComply rows={ROWS} />);
    const buttons = screen.getAllByRole("button", { name: /mark complied/i });
    fireEvent.click(buttons[0]);

    const dialog = await screen.findByRole("alertdialog");
    // Fill reason (required)
    const textarea = dialog.querySelector("textarea");
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea!, { target: { value: "Filed on time" } });
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Mark complied",
    );
    fireEvent.click(confirmBtn!);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/proxy/v1/estab/compliance/c1/comply",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});

describe("ComplianceTable — SF-14a (no raw response text on a failed comply)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("does not render the raw failure body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Traceback: psycopg at db-9.internal", { status: 500 }));
    render(<ComplianceTable canComply rows={ROWS} />);
    fireEvent.click(screen.getAllByRole("button", { name: /mark complied/i })[0]);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(dialog.querySelector("textarea")!, { target: { value: "Filed on time" } });
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Mark complied");
    fireEvent.click(confirmBtn!);
    await waitFor(() => expect(document.body.textContent).toMatch(/couldn.t|try again|save/i));
    expect(document.body.textContent).not.toContain("db-9.internal");
  });
});

describe("ComplianceTable — GAP-ESTAB-COMPLIANCE-03 (role gate)", () => {
  it("Given a viewer who may not comply (audit officer), When the table renders, Then there is no Action column and no Mark complied button", () => {
    render(<ComplianceTable rows={ROWS} />);
    expect(screen.queryByRole("button", { name: /mark complied/i })).not.toBeInTheDocument();
    // Title, Category, Assigned to, Due, Status: the sixth (Action) column is absent.
    expect(screen.getAllByRole("columnheader")).toHaveLength(5);
    // The register itself is still readable.
    expect(screen.getByText("Submit RTI annual report")).toBeInTheDocument();
  });
});
