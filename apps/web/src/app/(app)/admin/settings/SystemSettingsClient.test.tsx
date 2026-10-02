import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SystemSettingsClient } from "./SystemSettingsClient";

const hidden = { state: "hidden" } as const;

function patches(spy: MockInstance<typeof fetch>) {
  return spy.mock.calls.filter(([, init]) => String((init as RequestInit | undefined)?.method) === "PATCH");
}

describe("SystemSettingsClient", () => {
  let spy: MockInstance<typeof fetch>;
  beforeEach(() => {
    vi.restoreAllMocks();
    spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
  });

  // GAP-ADMIN-SETTINGS-01
  it("starts blank: no invented 'Ministry of Finance' / smtp.nic.in defaults are shown as current values", () => {
    render(<SystemSettingsClient tenant={hidden} />);
    expect((screen.getByLabelText(/Organisation name/) as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("tab", { name: "Email" }));
    expect((screen.getByLabelText(/SMTP host/) as HTMLInputElement).value).toBe("");
    expect(screen.queryByDisplayValue("smtp.nic.in")).not.toBeInTheDocument();
  });

  it("editing only the from-name sends only { fromName }, never an empty smtpPass or seed defaults", async () => {
    render(<SystemSettingsClient tenant={hidden} />);
    fireEvent.click(screen.getByRole("tab", { name: "Email" }));
    fireEvent.change(screen.getByLabelText("From name"), { target: { value: "Office Mail" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(patches(spy)).toHaveLength(1));
    expect(JSON.parse((patches(spy)[0]![1] as RequestInit).body as string)).toEqual({ fromName: "Office Mail" });
  });

  it("includes smtpPass only when one was typed", async () => {
    render(<SystemSettingsClient tenant={hidden} />);
    fireEvent.click(screen.getByRole("tab", { name: "Email" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "typed-new-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(patches(spy)).toHaveLength(1));
    expect(JSON.parse((patches(spy)[0]![1] as RequestInit).body as string)).toEqual({ smtpPass: "typed-new-value" });
  });

  it("Save stays disabled until a field is edited", () => {
    render(<SystemSettingsClient tenant={hidden} />);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  // GAP-ADMIN-SETTINGS-03
  it("rejects a bad CIDR and an emptied timeout: per-field errors, no request", async () => {
    render(<SystemSettingsClient tenant={hidden} />);
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));
    fireEvent.change(screen.getByLabelText(/IP whitelist/), { target: { value: "10.0.0.0/33" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/not a valid CIDR range/)).toBeInTheDocument();
    expect(patches(spy)).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/IP whitelist/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/Session timeout/), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Session timeout/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Enter 5-480")).toBeInTheDocument();
    expect(patches(spy)).toHaveLength(0);
  });

  it("a non-empty allow-list opens the lockout warning before anything is sent", async () => {
    render(<SystemSettingsClient tenant={hidden} />);
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));
    fireEvent.change(screen.getByLabelText(/IP whitelist/), { target: { value: "10.0.0.0/8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/your own IP address is included/)).toBeInTheDocument();
    expect(patches(spy)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save security settings" }));
    await waitFor(() => expect(patches(spy)).toHaveLength(1));
    expect(JSON.parse((patches(spy)[0]![1] as RequestInit).body as string)).toEqual({ ipWhitelist: "10.0.0.0/8" });
  });

  // GAP-ADMIN-SETTINGS-02
  it("the Tenant Config tab is absent for non-platform staff", () => {
    render(<SystemSettingsClient tenant={hidden} />);
    expect(screen.queryByRole("tab", { name: "Tenant Config" })).not.toBeInTheDocument();
  });

  it("platform staff see the real tenant record, with none of the old hard-coded strings", () => {
    render(<SystemSettingsClient tenant={{ state: "ready", name: "Dept of Posts", domain: "posts.gov.in", edition: "pro", status: "active", region: "ap-south-1" }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Tenant Config" }));
    expect(screen.getByText("Dept of Posts")).toBeInTheDocument();
    expect(screen.getByText("posts.gov.in")).toBeInTheDocument();
    expect(screen.queryByText(/Ministry of Finance/)).not.toBeInTheDocument();
    expect(screen.queryByText(/finmin/)).not.toBeInTheDocument();
    expect(screen.queryByText(/42 GB/)).not.toBeInTheDocument();
  });
});

// GAP-ADMIN-SETTINGS-04/-05/-06/-07
describe("SystemSettingsClient - tabs, state retention, logo, test email", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
  });
  const platform = { state: "ready", name: "N", domain: "d", edition: "e", status: "s", region: "r" } as const;

  it("keeps an edit and its dirty marker when switching tabs and back", () => {
    render(<SystemSettingsClient tenant={hidden} />);
    fireEvent.click(screen.getByRole("tab", { name: "Email" }));
    fireEvent.change(screen.getByLabelText(/SMTP host/), { target: { value: "mail.example.gov.in" } });
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));
    expect(screen.getByRole("tab", { name: /Email.*unsaved changes/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Email/ }));
    expect((screen.getByLabelText(/SMTP host/) as HTMLInputElement).value).toBe("mail.example.gov.in");
  });

  it("registers a beforeunload guard only while a section is dirty", () => {
    const add = vi.spyOn(window, "addEventListener");
    render(<SystemSettingsClient tenant={hidden} />);
    expect(add.mock.calls.some(([t]) => t === "beforeunload")).toBe(false);
    fireEvent.change(screen.getByLabelText(/Organisation name/), { target: { value: "X" } });
    expect(add.mock.calls.some(([t]) => t === "beforeunload")).toBe(true);
  });

  it("arrow keys move selection with a roving tabindex; the panel is labelled by its tab", () => {
    render(<SystemSettingsClient tenant={hidden} />);
    const general = screen.getByRole("tab", { name: "General" });
    expect(general).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Email" })).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(general, { key: "ArrowRight" });
    const email = screen.getByRole("tab", { name: "Email" });
    expect(email).toHaveAttribute("aria-selected", "true");
    expect(email).toHaveAttribute("tabindex", "0");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", email.id);
    expect(email.getAttribute("aria-controls")).toBe(panel.id);
    fireEvent.keyDown(email, { key: "End" });
    expect(screen.getByRole("tab", { name: "Integrations" })).toHaveAttribute("aria-selected", "true");
  });

  it("the subtitle names every tab, including Tenant Config for platform staff", () => {
    const { unmount } = render(<SystemSettingsClient tenant={platform} />);
    expect(screen.getByText(/General, Email, Security, Integrations, and Tenant Config/)).toBeInTheDocument();
    unmount();
    render(<SystemSettingsClient tenant={hidden} />);
    expect(screen.getByText(/General, Email, Security, and Integrations/)).toBeInTheDocument();
  });

  it("no dead logo drop zone: an honest notice, and no logoUrl ever reaches the PATCH", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<SystemSettingsClient tenant={hidden} />);
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByText(/logo upload is not available yet/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Organisation name/), { target: { value: "Office" } });
    fireEvent.click(screen.getAllByRole("button", { name: /save changes/i })[0]);
    await waitFor(() => expect(patches(spy).length).toBe(1));
    expect(JSON.parse((patches(spy)[0][1] as RequestInit).body as string)).toEqual({ orgName: "Office" });
  });

  it("the email test button says it tests the SAVED settings", () => {
    render(<SystemSettingsClient tenant={hidden} />);
    fireEvent.click(screen.getByRole("tab", { name: "Email" }));
    expect(screen.getByRole("button", { name: "Test saved settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send test email" })).not.toBeInTheDocument();
  });
});
