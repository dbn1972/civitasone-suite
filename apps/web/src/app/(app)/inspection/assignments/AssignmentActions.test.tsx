import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { AssignmentActions } from "./AssignmentActions";

const INSPECTION = "11111111-1111-4111-8111-000000000001";
const INSPECTOR = "22222222-2222-4222-8222-000000000002";
const TYPE = "33333333-3333-4333-8333-000000000003";
const ENTITY = "44444444-4444-4444-8444-000000000004";

/** Routed fetch: each lookup endpoint returns one option; the POST returns 202. */
function stubFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
    if (url.includes("/inspection/inspections")) return ok({ data: [{ id: INSPECTION, state: "scheduled", createdAt: "2026-10-07T00:00:00Z" }] });
    if (url.includes("/identity/users/directory")) return ok({ data: [{ id: INSPECTOR, displayName: "Inspector Asha" }] });
    if (url.includes("/inspection/types")) return ok({ data: [{ id: TYPE, name: "Fire Safety", code: "FS" }] });
    if (url.includes("/inspection/entities")) return ok({ data: [{ id: ENTITY, name: "Acme Factory", registrationNo: "REG-9", entityType: "factory" }] });
    return Promise.resolve(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));
  });
}

async function selectOn(labelRe: RegExp, type: string, optionText: string) {
  const combo = screen.getByRole("combobox", { name: labelRe }) as HTMLInputElement;
  fireEvent.focus(combo);
  fireEvent.change(combo, { target: { value: type } });
  // Pick the listbox option whose rendered label contains optionText — more
  // robust than findByText, which can match the picker's status live-region.
  const option = await screen.findByRole("option", {
    name: (accessibleName: string) => accessibleName.includes(optionText),
  });
  fireEvent.mouseDown(option);
  await waitFor(() => expect(combo.value).not.toBe(type));
}

describe("GAP-INSPECTION-ASSIGNMENTS-01 AssignmentActions (pickers replace raw UUID boxes)", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("renders four labelled comboboxes, not raw 'UUID' text inputs", () => {
    stubFetch();
    render(<AssignmentActions />);
    expect(screen.getByRole("combobox", { name: /^Inspection$/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /inspector/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /inspection type/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /entity/i })).toBeInTheDocument();
    // No input still advertises a bare "UUID" placeholder.
    expect(document.querySelector('input[placeholder="UUID"]')).toBeNull();
  });

  it("blocks submit until all four pickers have a selection (no POST)", async () => {
    const fetchSpy = stubFetch();
    render(<AssignmentActions />);
    fireEvent.click(screen.getByText("Create assignment"));
    expect(await screen.findAllByText("Select a value.")).not.toHaveLength(0);
    expect(fetchSpy.mock.calls.some((c) => String(c[0]) === "/api/proxy/v1/inspection/assignments")).toBe(false);
  });

  it("POSTs the four selected UUIDs once every picker is chosen", async () => {
    const fetchSpy = stubFetch();
    render(<AssignmentActions />);

    await selectOn(/^Inspection$/i, "sched", "scheduled");
    await selectOn(/inspector/i, "Asha", "Inspector Asha");
    await selectOn(/inspection type/i, "Fire", "Fire Safety");
    await selectOn(/entity/i, "Acme", "Acme Factory");

    fireEvent.click(screen.getByText("Create assignment"));

    await waitFor(() =>
      expect(fetchSpy.mock.calls.some((c) => String(c[0]) === "/api/proxy/v1/inspection/assignments")).toBe(true),
    );
    const postCall = fetchSpy.mock.calls.find((c) => String(c[0]) === "/api/proxy/v1/inspection/assignments")!;
    const body = JSON.parse((postCall[1] as RequestInit).body as string);
    expect(body.inspectionId).toBe(INSPECTION);
    expect(body.inspectorId).toBe(INSPECTOR);
    expect(body.inspectionTypeId).toBe(TYPE);
    expect(body.entityId).toBe(ENTITY);
    expect(body.scheduledDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
