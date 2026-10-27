import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@/test-utils/intl-render";
import { ConsentDecisionPanel } from "./ConsentDecisionPanel";

const pending = [{ id: "c1", label: "Assess — Revenue" }];

describe("ConsentDecisionPanel (owner decision #19)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("approve needs a reason, posts once to the grant route and disables the buttons while pending", async () => {
    let resolve!: (r: Response) => void;
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>((r) => { resolve = r; }));
    render(<ConsentDecisionPanel pending={pending} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve: Assess/ }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Approve") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // no reason yet
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "Citizen consented in person" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    fireEvent.click(confirm); // double click must not double-post
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/tenant/consent/c1/grant");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "Citizen consented in person" });
    expect((screen.getByRole("button", { name: /Reject: Assess/ }) as HTMLButtonElement).disabled).toBe(true);
    resolve(new Response("{}", { status: 202 }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/approved/i));
  });

  it("reject posts to the deny route", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<ConsentDecisionPanel pending={pending} />);
    fireEvent.click(screen.getByRole("button", { name: /Reject: Assess/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "Purpose not lawful" } });
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Reject") as HTMLButtonElement);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect((spy.mock.calls[0] as [string])[0]).toBe("/api/proxy/v1/tenant/consent/c1/deny");
  });

  it("a server refusal shows a plain-language error and no success message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "SELF_APPROVAL", message: "raw server text" }), { status: 403 }));
    render(<ConsentDecisionPanel pending={pending} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve: Assess/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "ok reason here" } });
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Approve") as HTMLButtonElement);
    await waitFor(() => expect(dialog.textContent).toMatch(/not allowed|permission|can.t|cannot/i));
    expect(dialog.textContent).not.toContain("raw server text");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows an empty state when nothing is pending", () => {
    render(<ConsentDecisionPanel pending={[]} />);
    expect(screen.getByText(/No consent requests are awaiting a decision/)).toBeTruthy();
  });
});
