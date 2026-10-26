import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { render } from "@/test-utils/intl-render";
import { IpReveal } from "./IpReveal";

async function submit(reason: string) {
  fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: reason } });
  fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Reveal") as HTMLButtonElement);
  return dialog;
}

describe("IpReveal (owner decision #21)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows only the masked IP and no control to a viewer who may not reveal", () => {
    render(<IpReveal sessionId="s1" maskedIp="10.1.*.*" canReveal={false} />);
    expect(screen.getByText("10.1.*.*")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a security admin supplies a reason, posts once, sees the clear IP and can hide it again", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "s1", ipAddress: "10.1.2.3" }), { status: 200 }));
    render(<IpReveal sessionId="s1" maskedIp="10.1.*.*" canReveal />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Reveal") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "Ticket SEC-114 credential sharing" } });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByText("10.1.2.3")).toBeInTheDocument());
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/identity/sessions/s1/reveal-ip");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "Ticket SEC-114 credential sharing" });
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("10.1.2.3")).toBeNull();
    expect(screen.getByText("10.1.*.*")).toBeInTheDocument();
  });

  it("a server refusal keeps the IP masked and shows a plain-language error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN", message: "requires one of: security_admin" }), { status: 403 }));
    render(<IpReveal sessionId="s1" maskedIp="10.1.*.*" canReveal />);
    const dialog = await submit("Ticket SEC-114 credential sharing");
    await waitFor(() => expect(dialog.textContent).toMatch(/permission|not allowed|can.t|cannot/i));
    expect(dialog.textContent).not.toContain("requires one of");
    expect(screen.getByText("10.1.*.*")).toBeInTheDocument();
  });
});
