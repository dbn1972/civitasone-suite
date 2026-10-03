import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { OnboardingTable } from "./OnboardingTable";
import { onboardingStageTone, onboardingStats, provisioningHref, toOnboardingRows } from "./onboardingStats";
import { useSeededResource } from "@/lib/sync/resource";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

const q = (stage: string, org = stage) => ({ org, contact: "a@b.gov.in", requested: "2026-09-01", assigned: "x", stage });
function seeded(data: Record<string, unknown>[], provenance: "live" | "cached" | "error-no-data") {
  vi.mocked(useSeededResource).mockReturnValue({ data, fromCache: provenance === "cached", offline: false, cachedAt: null, provenance } as never);
}

describe("onboardingStats (GAP-ADMIN-ONBOARDING-04)", () => {
  it("In Queue excludes completed rows", () => {
    expect(onboardingStats(toOnboardingRows([q("new request"), q("completed", "c1"), q("completed", "c2")])).inQueue).toBe(1);
  });
  it("a blocked stage is not counted In Progress; it is surfaced as Other", () => {
    const s = onboardingStats(toOnboardingRows([q("blocked"), q("in progress"), q("go-live pending"), q("new request")]));
    expect(s).toMatchObject({ inQueue: 4, inProgress: 1, ready: 1, newReqs: 1, other: 1 });
  });
  it("tones the stages the page uses (GAP-ADMIN-ONBOARDING-06)", () => {
    expect(onboardingStageTone("go-live pending")).toBe("warn");
    expect(onboardingStageTone("completed")).toBe("good");
  });
});

describe("OnboardingTable (GAP-ADMIN-ONBOARDING-02/-03)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cached rows with empty server list: New Requests equals the table's new-request rows", () => {
    seeded([q("new request", "o1"), q("new request", "o2"), q("completed", "o3")], "cached");
    render(<OnboardingTable queue={[]} />);
    expect(screen.getByText("New Requests").parentElement).toHaveTextContent("2");
    expect(screen.getByText("In Queue").parentElement).toHaveTextContent("2");
  });

  it("failure with no cache: dashes + retry, not the empty-queue message", () => {
    seeded([], "error-no-data");
    render(<OnboardingTable queue={[]} source="error" errorStatus={500} />);
    expect(screen.getByText("New Requests").parentElement).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No requests")).not.toBeInTheDocument();
  });

  it("403 is access restricted", () => {
    seeded([], "error-no-data");
    render(<OnboardingTable queue={[]} source="error" errorStatus={403} />);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });
});

// GAP-ADMIN-ONBOARDING-05 / -07

const ID1 = "6f1c1d5e-3a0b-4f0e-9c1d-2b7d8a9e4c11";
const ID2 = "7a2d2e6f-4b1c-4a1f-8d2e-3c8e9b0f5d22";
const masked = (stage: string, org: string, id: string) => ({ id, org, contact: "J*** D*** · j***@dept.gov.in", requested: "2026-09-01", assigned: "", stage });

describe("provisioningHref (GAP-ADMIN-ONBOARDING-07)", () => {
  it("open stages link to provisioning with the request id; closed or id-less rows do not", () => {
    expect(provisioningHref({ id: ID1, stage: "new request" })).toBe(`/admin/tenant-provision?requestId=${ID1}`);
    expect(provisioningHref({ id: ID1, stage: "go-live pending" })).toBe(`/admin/tenant-provision?requestId=${ID1}`);
    expect(provisioningHref({ id: ID1, stage: "completed" })).toBeNull();
    expect(provisioningHref({ id: ID1, stage: "Rejected" })).toBeNull();
    expect(provisioningHref({ id: "", stage: "new request" })).toBeNull();
  });
});

describe("OnboardingTable masked contact, reveal and export (GAP-ADMIN-ONBOARDING-05)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

  it("shows the contact masked; no Reveal control without the permission, and no Export button", () => {
    seeded([masked("new request", "Roads", ID1)], "live");
    render(<OnboardingTable queue={[]} />);
    expect(screen.getByText(/J\*\*\* D\*\*\* · j\*\*\*@dept\.gov\.in/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reveal contact/ })).not.toBeInTheDocument();
    expect(screen.queryByText("⬇ CSV")).not.toBeInTheDocument();
  });

  it("Reveal needs a reason, posts it once, then shows the clear contact; Hide masks it again", async () => {
    seeded([masked("new request", "Roads", ID1)], "live");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: ID1, contactName: "Jane Doe", contactEmail: "jane.doe@dept.gov.in" } }), { status: 200 }),
    );
    render(<OnboardingTable queue={[]} canReveal />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal contact for Roads" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Reveal" })).toBeDisabled();
    expect(spy).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Call back about go-live" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reveal" }));
    await waitFor(() => expect(screen.getByText(/Jane Doe · jane\.doe@dept\.gov\.in/)).toBeInTheDocument());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe(`/api/proxy/v1/admin/onboarding/${ID1}/reveal`);
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ reason: "Call back about go-live" });
    fireEvent.click(screen.getByRole("button", { name: "Hide contact for Roads" }));
    expect(screen.queryByText(/jane\.doe@dept\.gov\.in/)).not.toBeInTheDocument();
  });

  it("a failed reveal keeps the contact masked and explains why in the dialog, without a status code", async () => {
    seeded([masked("new request", "Roads", ID1)], "live");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 503 }));
    render(<OnboardingTable queue={[]} canReveal />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal contact for Roads" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "support ticket 4411" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reveal" }));
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alertdialog").textContent).not.toMatch(/503/);
    expect(screen.queryByText(/jane\.doe/)).not.toBeInTheDocument();
  });

  it("Export is shown with the permission and is audit-first: a failed audit blocks the file", async () => {
    seeded([masked("new request", "Roads", ID1)], "live");
    const created = vi.fn(() => "blob:x");
    URL.createObjectURL = created; URL.revokeObjectURL = vi.fn();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    render(<OnboardingTable queue={[]} canExport />);
    fireEvent.click(screen.getByText("⬇ CSV"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no file was created/));
    expect(created).not.toHaveBeenCalled();
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ resource: "onboarding", rowCount: 1, filtered: false });
  });

  it("an accepted audit lets the file through, and it carries the MASKED contact only", async () => {
    seeded([masked("new request", "Roads", ID1)], "live");
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return "blob:x"; }); URL.revokeObjectURL = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<OnboardingTable queue={[]} canExport />);
    fireEvent.click(screen.getByText("⬇ CSV"));
    await waitFor(() => expect(blobs).toHaveLength(1));
    const text = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsText(blobs[0]!); });
    expect(text).toContain("J*** D*** · j***@dept.gov.in");
    expect(text).not.toContain("Open provisioning");
    expect(text.split("\n")[0]).toBe("Organisation,Contact,Requested,Assigned To,Stage");
  });

  it("open requests link to provisioning with their id; closed requests have no link", () => {
    seeded([masked("new request", "Roads", ID1), masked("completed", "Done Org", ID2)], "live");
    render(<OnboardingTable queue={[]} />);
    expect(screen.getByRole("link", { name: "Open provisioning for Roads" })).toHaveAttribute("href", `/admin/tenant-provision?requestId=${ID1}`);
    expect(screen.queryByRole("link", { name: "Open provisioning for Done Org" })).not.toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
  });
});

// Queue management without an API client (reviewer follow-up)
describe("OnboardingTable create and stage moves", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

  it("no create button or move actions without canManage", () => {
    seeded([masked("new request", "Roads", ID1)], "live");
    render(<OnboardingTable queue={[]} />);
    expect(screen.queryByRole("button", { name: "+ New onboarding request" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start work/ })).not.toBeInTheDocument();
  });

  it("creates a request: the form needs valid fields, posts them, and tells the user it was accepted", async () => {
    seeded([], "live");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<OnboardingTable queue={[]} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "+ New onboarding request" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Add request" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Organisation name"), { target: { value: "Dept of Roads" } });
    fireEvent.change(within(dialog).getByLabelText("Contact name"), { target: { value: "Jane Doe" } });
    fireEvent.change(within(dialog).getByLabelText("Contact e-mail"), { target: { value: "not-an-email" } });
    expect(within(dialog).getByRole("button", { name: "Add request" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Contact e-mail"), { target: { value: "jane@dept.gov.in" } });
    fireEvent.change(within(dialog).getByLabelText("Notes (optional)"), { target: { value: "urgent" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add request" }));
    await waitFor(() => expect(screen.getByText(/Request accepted/)).toBeInTheDocument());
    expect(spy.mock.calls[0]![0]).toBe("/api/proxy/v1/admin/onboarding");
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ orgName: "Dept of Roads", contactName: "Jane Doe", contactEmail: "jane@dept.gov.in", notes: "urgent" });
  });

  it("offers only the steps the stage machine allows", () => {
    seeded([masked("new request", "A Org", ID1), masked("go-live pending", "B Org", ID2), masked("completed", "C Org", "8b3e3f70-5c2d-4b20-9e3f-4d9f0a1b6e33")], "live");
    render(<OnboardingTable queue={[]} canManage />);
    expect(screen.getByRole("button", { name: "Start work: A Org" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Complete: A Org" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete: B Org" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /: C Org/ })).not.toBeInTheDocument();
  });

  it("advancing sends from/to once and shows the new stage; no reason is required", async () => {
    seeded([masked("new request", "A Org", ID1)], "live");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<OnboardingTable queue={[]} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Start work: A Org" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Start work" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0]![0]).toBe(`/api/proxy/v1/admin/onboarding/${ID1}/stage`);
    expect((spy.mock.calls[0]![1] as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ from: "new request", to: "in progress" });
    await waitFor(() => expect(screen.getByText(/in progress/i, { selector: ".pill" })).toBeInTheDocument());
  });

  it("reject and cancel require a reason before they can be confirmed", async () => {
    seeded([masked("new request", "A Org", ID1)], "live");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<OnboardingTable queue={[]} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Reject: A Org" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Reject" })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Not a government body" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ from: "new request", to: "rejected", note: "Not a government body" });
  });

  it("completing validates the optional tenant id and sends it only on that move", async () => {
    seeded([masked("go-live pending", "B Org", ID2)], "live");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<OnboardingTable queue={[]} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Complete: B Org" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Provisioned tenant id/), { target: { value: "nope" } });
    expect(within(dialog).getByRole("button", { name: "Complete" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Provisioned tenant id/), { target: { value: ID1 } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ from: "go-live pending", to: "completed", provisionedTenantId: ID1 });
  });

  it("a 409 from a racing operator is explained in the dialog and the stage does not change", async () => {
    seeded([masked("new request", "A Org", ID1)], "live");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { code: "STAGE_CHANGED" } }), { status: 409 }));
    render(<OnboardingTable queue={[]} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Start work: A Org" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Start work" }));
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toHaveTextContent(/already moved/));
    expect(screen.getAllByText(/new request/i, { selector: ".pill" }).length).toBeGreaterThan(0);
  });
});
