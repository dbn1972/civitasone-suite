import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const PICK = "99999999-2222-4333-8444-555555555555";
// The real picker is async/searchable; a button that selects a fixed id keeps these tests about the wiring.
vi.mock("@/app/_components/ds", async (orig) => {
  const actual = await orig<typeof import("@/app/_components/ds")>();
  return {
    ...actual,
    EntityPicker: (p: { multiple?: boolean; onChange: (v: unknown) => void; "aria-label"?: string; placeholder?: string }) => (
      <button type="button" onClick={() => p.onChange(p.multiple ? [PICK] : PICK)}>
        {`pick ${p["aria-label"] ?? p.placeholder}`}
      </button>
    ),
  };
});

import { NewInspectionForm } from "./inspections/NewInspectionForm";
import { FindingsPanel } from "./inspections/[id]/FindingsPanel";
import { CapaRowAction } from "./capa/CapaActions";

const INSP = "11111111-2222-4333-8444-555555555555";
const FINDING = "aaaaaaaa-1111-4000-8000-000000000001";

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(JSON.stringify({ data: { status: "accepted" } }), { status: 202 }),
  );
}
const call = (spy: ReturnType<typeof mockFetch>, i = 0) => {
  const [url, init] = spy.mock.calls[i]!;
  const body = (init as RequestInit).body;
  return { url: String(url), method: (init as RequestInit).method, body: body ? JSON.parse(String(body)) : undefined };
};

beforeEach(() => vi.restoreAllMocks());

describe("NewInspectionForm (schedule an inspection)", () => {
  it("POSTs /inspections with entityId, inspectionTypeId and assignedInspectors", async () => {
    const spy = mockFetch();
    render(<NewInspectionForm />);
    fireEvent.click(screen.getByRole("button", { name: "pick Regulated entity" }));
    fireEvent.click(screen.getByRole("button", { name: "pick Inspection type" }));
    fireEvent.click(screen.getByRole("button", { name: "pick Inspectors (optional)" }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule inspection" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(call(spy)).toEqual({
      url: "/api/proxy/v1/inspection/inspections",
      method: "POST",
      body: { entityId: PICK, inspectionTypeId: PICK, assignedInspectors: [PICK] },
    });
  });

  it("does not call the API until entity and type are chosen", () => {
    const spy = mockFetch();
    render(<NewInspectionForm />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule inspection" }));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/choose the regulated entity/i);
  });
});

describe("FindingsPanel (finding -> notice -> verify -> CAPA)", () => {
  const open = { id: FINDING, findingNumber: "FND-2026-000001", severity: "major", state: "open", description: "Fire exit blocked" };

  it("raises a finding: POST /findings { inspectionId, provisionId, description }", async () => {
    const spy = mockFetch();
    render(<FindingsPanel inspectionId={INSP} findings={[]} canWrite canNotice canCapa />);
    fireEvent.click(screen.getByRole("button", { name: "pick Legal provision" }));
    fireEvent.change(screen.getByLabelText(/What was found/), { target: { value: "  Fire exit blocked  " } });
    fireEvent.click(screen.getByRole("button", { name: "Raise finding" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(call(spy)).toEqual({
      url: "/api/proxy/v1/inspection/findings",
      method: "POST",
      body: { inspectionId: INSP, provisionId: PICK, description: "Fire exit blocked" },
    });
  });

  it("issues a compliance notice with dueDate, requiredAction and responsibleParty", async () => {
    const spy = mockFetch();
    render(<FindingsPanel inspectionId={INSP} findings={[open]} canWrite canNotice canCapa />);
    fireEvent.click(screen.getByRole("button", { name: "Issue notice" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Issue notice" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Due date"), { target: { value: "2099-01-31" } });
    fireEvent.change(within(dialog).getByLabelText("Required action"), { target: { value: "Clear the exit" } });
    fireEvent.change(within(dialog).getByLabelText("Responsible party"), { target: { value: "Site manager" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(call(spy)).toEqual({
      url: `/api/proxy/v1/inspection/findings/${FINDING}/compliance-notice`,
      method: "POST",
      body: { dueDate: "2099-01-31", requiredAction: "Clear the exit", responsibleParty: "Site manager" },
    });
  });

  it("verifies a finding resolved: POST /findings/:id/verify", async () => {
    const spy = mockFetch();
    render(<FindingsPanel inspectionId={INSP} findings={[open]} canWrite canNotice canCapa />);
    fireEvent.click(screen.getByRole("button", { name: "Verify resolved" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm resolved" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(call(spy)).toMatchObject({ url: `/api/proxy/v1/inspection/findings/${FINDING}/verify`, method: "POST" });
  });

  it("raises a CAPA for the finding: POST /capa { findingId, type, description }", async () => {
    const spy = mockFetch();
    render(<FindingsPanel inspectionId={INSP} findings={[open]} canWrite canNotice canCapa />);
    fireEvent.click(screen.getByRole("button", { name: "Raise CAPA" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Raise CAPA" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Action required"), { target: { value: "Re-route stock" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(call(spy)).toEqual({
      url: "/api/proxy/v1/inspection/capa",
      method: "POST",
      body: { findingId: FINDING, type: "corrective", description: "Re-route stock" },
    });
  });

  it("offers only what the role allows", () => {
    render(<FindingsPanel inspectionId={INSP} findings={[open]} canWrite={false} canNotice={false} canCapa={false} />);
    expect(screen.queryByRole("button", { name: "Issue notice" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Verify resolved" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Raise CAPA" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Raise finding" })).toBeNull();
  });
});

describe("CapaRowAction re-inspection", () => {
  it("a verified CAPA triggers re-inspection: POST /capa/:id/trigger-reinspection", async () => {
    const spy = mockFetch();
    render(<CapaRowAction id={FINDING} status="verified" />);
    fireEvent.click(screen.getByRole("button", { name: "Trigger re-inspection" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Trigger re-inspection" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(call(spy)).toMatchObject({ url: `/api/proxy/v1/inspection/capa/${FINDING}/trigger-reinspection`, method: "POST" });
  });

  it("is not offered again once triggered", () => {
    render(<CapaRowAction id={FINDING} status="verified" reInspectionTriggered />);
    expect(screen.queryByRole("button", { name: "Trigger re-inspection" })).toBeNull();
  });
});
