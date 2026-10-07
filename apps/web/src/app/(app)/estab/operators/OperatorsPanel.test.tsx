import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

import { OperatorsPanel } from "./OperatorsPanel";

const OP = {
  id: "op-1",
  employeeId: "123e4567-e89b-12d3-a456-426614174000",
  employeeName: "R. Sharma",
  departmentName: "Public Works",
  division: "Estt",
  section: null,
  deskRole: "joint_secretary",
  canInitiate: true,
  active: true,
  updatedAt: "2026-09-01T00:00:00Z",
};

describe("OperatorsPanel — role gate (GAP-ESTAB-OPERATORS-02)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("hides the Enrol form and Actions for a non-admin, showing a read-only note", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/estab/operators")) return jsonResponse({ data: [OP] });
      return jsonResponse({ data: [] });
    });
    render(<OperatorsPanel canAdminister={false} />);
    await screen.findByText("R. Sharma · Public Works");
    expect(screen.queryByText("Enrol a file operator")).toBeNull();
    expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(/restricted to division administrators/i);
  });

  it("shows the Enrol form and Actions for an admin", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/estab/operators")) return jsonResponse({ data: [OP] });
      return jsonResponse({ data: [] });
    });
    render(<OperatorsPanel canAdminister={true} />);
    expect(await screen.findByText("Enrol a file operator")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  });
});

describe("OperatorsPanel — officer name + role label (GAP-ESTAB-OPERATORS-01/06)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the resolved officer name (not a UUID) and humanizes an unknown desk role", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/estab/operators")) return jsonResponse({ data: [OP] });
      return jsonResponse({ data: [] });
    });
    render(<OperatorsPanel canAdminister={false} />);
    await screen.findByText("R. Sharma · Public Works");
    // Unknown enum "joint_secretary" humanized, not shown raw.
    expect(screen.getByText("Joint Secretary")).toBeInTheDocument();
    expect(screen.queryByText(/123e4567-e89b/)).toBeNull();
  });

  it("falls back to an 'Unresolved' hint (never a bare UUID) when the name is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/estab/operators")) return jsonResponse({ data: [{ ...OP, employeeName: undefined, departmentName: undefined }] });
      return jsonResponse({ data: [] });
    });
    render(<OperatorsPanel canAdminister={false} />);
    await screen.findByText(/Unresolved \(123e4567…\)/);
  });
});

describe("OperatorsPanel — clerk-safe errors (UX-016)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("propagates a clerk-safe message, not the raw body/status, when a toggle fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/estab/operators/op-1")) return new Response("", { status: 500 });
      if (u.includes("/estab/operators")) return jsonResponse({ data: [OP] });
      return jsonResponse({ data: [] });
    });

    render(<OperatorsPanel canAdminister={true} />);
    const toggleBtn = await screen.findByRole("button", { name: "Deactivate" });
    fireEvent.click(toggleBtn);
    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = within(dialog).getAllByRole("button").find((b) => b.textContent === "Deactivate");
    fireEvent.click(confirmBtn!);

    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/\b500\b/);
  });
});
