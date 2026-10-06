import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuditLogTable } from "./AuditLogTable";
import type { PlatformAuditEvent } from "./AuditLogTable";

function ev(partial: Partial<PlatformAuditEvent> & { id: string }): PlatformAuditEvent {
  return {
    timestamp: "2026-09-28T10:00:00.000Z",
    actor: "alice@example.gov.in",
    actorRole: "tenant_admin",
    actionType: "UPDATE",
    action: "role.update",
    targetEntity: "role:finance",
    outcome: "success",
    ...partial,
  };
}

describe("AuditLogTable", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  // GAP-PLATFORM-ADMIN-AUDIT-LOG-07: a missing actorRole must render
  // "Unknown", never a fabricated high-privilege role.
  it("renders an empty actorRole as 'Unknown', never a role name", () => {
    render(<AuditLogTable events={[ev({ id: "e1", actorRole: "" })]} />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.queryByText("platform_admin")).not.toBeInTheDocument();
  });

  // GAP-PLATFORM-ADMIN-AUDIT-LOG-04: the diff expander must be a real,
  // keyboard-operable button with aria-expanded, not a bare onClick <tr>.
  it("exposes a keyboard-operable expander button that toggles aria-expanded and reveals the diff", () => {
    render(
      <AuditLogTable events={[ev({ id: "e1", before: { status: "a" }, after: { status: "b" } })]} />,
    );
    const btn = screen.getByRole("button", { name: /show changes for role\.update/i });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: /show changes for role\.update/i })).toHaveAttribute("aria-expanded", "true");
    // Diff shows the before/after columns.
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
  });

  // GAP-PLATFORM-ADMIN-AUDIT-LOG-05: CSV export must neutralise formula
  // injection — a cell starting with = + - @ is prefixed with a single quote.
  it("escapes CSV formula-injection in the export", () => {
    let captured = "";
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    // jsdom does not implement URL.createObjectURL; define it for the test.
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const OriginalBlob = globalThis.Blob;
    const BlobCapture = function (parts: BlobPart[], opts?: BlobPropertyBag) {
      captured = String((parts ?? []).join(""));
      return new OriginalBlob(parts, opts);
    } as unknown as typeof Blob;
    vi.stubGlobal("Blob", BlobCapture);

    render(<AuditLogTable events={[ev({ id: "e1", actor: "=cmd|calc", action: "+danger" })]} canExport />);
    fireEvent.click(screen.getByRole("button", { name: /export current filtered view/i }));

    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    // Dangerous cells are prefixed with a single quote inside the quoted field.
    expect(captured).toContain(`"'=cmd|calc"`);
    expect(captured).toContain(`"'+danger"`);
  });

  // GAP-PLATFORM-ADMIN-AUDIT-LOG-05/02: the export button is hidden for a
  // viewer without an export role.
  it("hides the export button when canExport is false", () => {
    render(<AuditLogTable events={[ev({ id: "e1" })]} canExport={false} />);
    expect(screen.queryByRole("button", { name: /export/i })).not.toBeInTheDocument();
  });

  // GAP-PLATFORM-ADMIN-AUDIT-LOG-05/03: date filter compares on the IST
  // calendar day inclusive of the whole day — an event at 23:59:59.500Z of
  // 2026-09-28 (which is 2026-09-29 in IST) is included when filtering
  // to 2026-09-29.
  it("includes an event late in the IST day using inclusive IST-day bounds", () => {
    render(
      <AuditLogTable
        events={[
          ev({ id: "late", timestamp: "2026-09-28T23:59:59.500Z", actor: "late-actor@gov.in" }),
          ev({ id: "early", timestamp: "2026-09-27T02:00:00.000Z", actor: "early-actor@gov.in" }),
        ]}
      />,
    );
    // 2026-09-28T23:59:59.500Z is 2026-09-29 05:29 IST.
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-29" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-29" } });
    expect(screen.getByText("late-actor@gov.in")).toBeInTheDocument();
    expect(screen.queryByText("early-actor@gov.in")).not.toBeInTheDocument();
  });

  // GAP-PLATFORM-ADMIN-AUDIT-LOG-01: distinguish "zero events" from
  // "filters matched none".
  it("shows an honest empty-state message when there are genuinely no events", () => {
    render(<AuditLogTable events={[]} />);
    expect(screen.getByText("No audit events recorded yet.")).toBeInTheDocument();
  });
});
