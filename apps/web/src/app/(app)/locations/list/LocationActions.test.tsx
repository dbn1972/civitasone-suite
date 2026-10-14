import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";
import { LocationActions } from "./LocationActions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const RAW = "ERROR: relation \"locations\" violates constraint at db-7.internal:5432";

describe("LocationActions create failure (SF-14a: no raw response text)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows catalogued copy, never the raw response body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(RAW, { status: 500 }));
    render(<LocationActions rows={[]} />);
    fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "Pune office" } });
    fireEvent.click(screen.getByRole("button", { name: /add|create/i }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(document.body.textContent).not.toContain("db-7.internal");
    expect(document.body.textContent).not.toContain("violates constraint");
  });

  it("still maps backend fieldErrors inline", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "VALIDATION", fieldErrors: [{ field: "name", message: "Name is already used." }] }), { status: 400 }),
    );
    render(<LocationActions rows={[]} />);
    fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "Pune office" } });
    fireEvent.click(screen.getByRole("button", { name: /add|create/i }));
    expect(await screen.findByText("Name is already used.")).toBeInTheDocument();
  });
});

// GAP-LOCATIONS-LIST-05: after a successful add, focus returns to the name field
// and the polite status region announces it.
describe("LocationActions success (GAP-LOCATIONS-LIST-05)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("announces the add and moves focus back to the name field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "x", status: "accepted" }), { status: 202 }));
    render(<LocationActions rows={[]} />);
    const input = screen.getByLabelText("Location name");
    fireEvent.change(input, { target: { value: "Pune office" } });
    fireEvent.click(screen.getByRole("button", { name: "Add location" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Location added"));
    expect(document.activeElement).toBe(input);
  });

  it("offers only non-archived rows as parents", () => {
    render(<LocationActions rows={[{ id: "a", label: "HQ", status: "active" }, { id: "b", label: "Old", status: "archived" }]} />);
    expect(screen.getByRole("option", { name: "HQ" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Old" })).toBeNull();
  });
});

