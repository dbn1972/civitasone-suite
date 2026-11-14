import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import LeaveTypesClient from "./LeaveTypesClient";

const ROW = (o: Record<string, unknown>) => ({
  id: "t-pl", code: "PL", name: "Paid Leave (Project Contract Staff)", maxDays: 12, isEncashable: false, carryForward: false,
  lopFractionBps: 0, isActive: true, systemCode: "PL", category: "paid", genderRestriction: null, description: null, version: 3,
  activeAllocations: 5, openApplications: 0, totalApplications: 0, pendingChangeId: null, ...o,
});
const TYPES = [ROW({}), ROW({ id: "t-wfh", code: "WFH", name: "Work From Home Day", systemCode: null, activeAllocations: 0 }),
  ROW({ id: "t-old", code: "SL", name: "Sick Leave (Project Contract Staff)", isActive: false, activeAllocations: 0 })];
const CHANGE = { id: "c1", leaveTypeCode: "PRJ", leaveTypeName: "Project Leave", status: "pending", reason: "Unused since 2025",
  impact: { activeAllocations: 4, employeesWithAllocations: 4, balanceDaysOnLiveAllocations: 20 }, createdAt: "2026-11-10T00:00:00Z" };

function stub(over: Record<string, (init?: RequestInit) => Response | Promise<Response>> = {}, changes: unknown[] = []) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    for (const [k, fn] of Object.entries(over)) if (url.includes(k) && (!k.startsWith("POST ") )) return fn(init);
    if (url.includes("/admin/leave-types")) return new Response(JSON.stringify({ data: TYPES }), { status: 200 });
    if (url.includes("/leave-type-changes?")) return new Response(JSON.stringify({ data: changes }), { status: 200 });
    if (url.includes("/custom-rules") && !init?.method) return new Response(JSON.stringify({ enabled: false }), { status: 200 });
    return new Response("{}", { status: 202 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const renderIt = (locale: "en" | "hi" = "en") => render(
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}><LeaveTypesClient /></NextIntlClientProvider>);

afterEach(() => vi.unstubAllGlobals());

describe("LeaveTypesClient (S8-G3)", () => {
  it("lists types with live allocations, open applications and a text status (not colour alone)", async () => {
    stub();
    renderIt();
    const table = await screen.findByRole("table", { name: /leave types with live allocations/i });
    const pl = within(table).getByRole("row", { name: /Paid Leave/ });
    expect(within(pl).getByText("Active")).toBeInTheDocument();
    expect(within(table).getByText("Deactivated")).toBeInTheDocument();
    expect(within(table).getByText("Custom")).toBeInTheDocument();
  });

  it("deactivate shows the dry-run impact and sends a reason; nothing is deactivated by this screen alone", async () => {
    const fetchMock = stub({
      "/leave-types/t-pl/deactivate": (init) => JSON.parse(String(init?.body)).dryRun
        ? new Response(JSON.stringify({ impact: { activeAllocations: 5, employeesWithAllocations: 5, balanceDaysOnLiveAllocations: 50, openApplications: 0 }, blockers: [] }), { status: 200 })
        : new Response(JSON.stringify({ id: "r1" }), { status: 202 }),
    });
    renderIt();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Deactivate PL/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("end 5 live allocations held by 5 employees");
    expect(dialog).toHaveTextContent("second administrator approves");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Dead type, nobody can use it" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for approval" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Nothing changes until another administrator approves"));
    const real = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/deactivate")).map((c) => JSON.parse(String(c[1]!.body)));
    expect(real[0].dryRun).toBe(true);
    expect(real[1]).toEqual({ reason: "Dead type, nobody can use it" });
  });

  it("pending requests offer approve/reject; a self-approval 403 is explained in plain words", async () => {
    stub({ "/leave-type-changes/c1/approve": () => new Response(JSON.stringify({ code: "SELF_APPROVAL_FORBIDDEN", message: "x" }), { status: 403 }) }, [CHANGE]);
    renderIt();
    expect(await screen.findByText(/Awaiting your approval \(1\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Approve PRJ/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("another administrator must decide it"));
  });

  it("a new type must state its effect on pay (no silent default)", async () => {
    stub();
    renderIt();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Add leave type" }));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "PRJ" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Project Leave" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose the effect on pay.");
  });

  it("creates a type with the chosen pay effect", async () => {
    const fetchMock = stub();
    renderIt();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Add leave type" }));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "PRJ" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Project Leave" } });
    fireEvent.change(screen.getByLabelText("Effect on pay"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Leave type submitted."));
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST" && String(c[0]).endsWith("/leave-types"))!;
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({ code: "PRJ", name: "Project Leave", lopFractionBps: 0, systemCode: null });
  });

  it("the resolver switch is OFF by default and saves through the admin route", async () => {
    const fetchMock = stub();
    renderIt();
    await screen.findByRole("table");
    const sw = screen.getByLabelText("Use the leave rules my organisation defines") as HTMLInputElement;
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);
    await waitFor(() => expect(sw.checked).toBe(true));
    const put = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT")!;
    expect(String(put[0])).toContain("/leave-config/custom-rules");
    expect(JSON.parse(String(put[1]!.body))).toEqual({ enabled: true });
  });

  it("renders in Hindi with no missing message keys", async () => {
    stub();
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a); });
    renderIt("hi");
    await screen.findByRole("table");
    expect(screen.getByText("अवकाश के प्रकार", { selector: "h1" })).toBeInTheDocument();
    spy.mockRestore();
    expect(errors.filter((e) => String(e).includes("MISSING_MESSAGE"))).toEqual([]);
  });

  it("has no axe violations on the loaded screen (colour contrast needs a real browser)", async () => {
    stub();
    const { container } = renderIt();
    await screen.findByRole("table");
    const axe = (await import("axe-core")).default;
    const out = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(out.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});
