import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { SystemSettingsClient, type SettingsLoad } from "./SystemSettingsClient";
import { mapAdminSettings, type AdminSettings } from "@/app/_data/loaders";
import { changedFields, logoProblem, LOGO_MAX_BYTES } from "./settingsModel";
import enMessages from "@/messages/en.json";

// The page strings come from next-intl (en/hi); render with the real English catalogue.
vi.mock("next-intl", async (orig) => {
  const actual = await orig<typeof import("next-intl")>();
  const messages = (await import("@/messages/en.json")).default;
  return { ...actual, useTranslations: (ns?: string) => actual.createTranslator({ locale: "en", messages, namespace: ns as never }) };
});
void enMessages;

const hidden = { state: "hidden" } as const;
const section = (values: Record<string, unknown>, configured = true) => ({ configured, values, version: 3 });

const stored: AdminSettings = {
  general: section({ orgName: "Dept of Posts", timezone: "Asia/Kolkata", currency: "INR", dateFormat: "dd/MM/yyyy", fiscalYearStart: "04" }),
  email: section({ smtpHost: "smtp.dept.gov.in", smtpPort: 587, smtpUser: "mailer", fromName: "Posts", fromEmail: "noreply@dept.gov.in", useTls: true, hasPassword: true }),
  security: section({ sessionTimeoutMin: 30, maxLoginAttempts: 5, passwordMinLen: 12, mfaRequired: true, ipWhitelist: ["10.0.0.0/8", "192.168.1.0/24"] }),
  integrations: section({ pfmsUrl: "https://pfms.example.gov.in", nicGatewayUrl: "", digiLockerEnabled: true, umangEnabled: false }),
  hasSmtpPassword: true,
  logo: { present: false, contentType: null, sizeBytes: null },
};
const ready = (over: Partial<AdminSettings> = {}): SettingsLoad => ({ state: "ready", settings: { ...stored, ...over } });
const unconfigured = ready({
  general: section({}, false), email: section({}, false), security: section({}, false), integrations: section({}, false), hasSmtpPassword: false,
});

function patches(spy: MockInstance<typeof fetch>) {
  return spy.mock.calls.filter(([, init]) => String((init as RequestInit | undefined)?.method) === "PATCH");
}
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

describe("SystemSettingsClient", () => {
  let spy: MockInstance<typeof fetch>;
  beforeEach(() => {
    vi.restoreAllMocks();
    spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
  });

  // GAP-ADMIN-SETTINGS-01
  it("shows the STORED values, not blanks or seed defaults", () => {
    render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
    expect((screen.getByLabelText(/Organisation name/) as HTMLInputElement).value).toBe("Dept of Posts");
    fireEvent.click(screen.getByRole("tab", { name: "Email" }));
    expect((screen.getByLabelText(/SMTP host/) as HTMLInputElement).value).toBe("smtp.dept.gov.in");
    expect((screen.getByLabelText(/Port/) as HTMLInputElement).value).toBe("587");
    expect(screen.queryByDisplayValue("smtp.nic.in")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));
    expect((screen.getByLabelText(/IP whitelist/) as HTMLTextAreaElement).value).toBe("10.0.0.0/8\n192.168.1.0/24");
    expect((screen.getByLabelText(/Session timeout/) as HTMLInputElement).value).toBe("30");
  });

  it("an unsaved section says so, and Save stays disabled until a field changes from what was loaded", () => {
    render(<SystemSettingsClient tenant={hidden} settings={unconfigured} />);
    expect(screen.getAllByText(/Nothing has been saved for this section yet/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    const input = screen.getByLabelText(/Organisation name/);
    fireEvent.change(input, { target: { value: "X" } });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    fireEvent.change(input, { target: { value: "" } }); // back to what was loaded
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("editing only the from-name sends only { fromName }, never the unchanged stored values or an empty smtpPass", async () => {
    render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Email" }));
    fireEvent.change(screen.getByLabelText("From name"), { target: { value: "Office Mail" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(patches(spy)).toHaveLength(1));
    expect(bodyOf(patches(spy)[0]!)).toEqual({ fromName: "Office Mail" });
    expect(String(patches(spy)[0]![0])).toBe("/api/proxy/v1/admin/settings/email");
  });

  it("the stored password is never shown; the field says one is saved, and it is sent only when typed", async () => {
    render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Email" }));
    const pass = screen.getByLabelText("Password") as HTMLInputElement;
    expect(pass.value).toBe("");
    expect(pass.placeholder).toMatch(/A password is saved/);
    fireEvent.change(pass, { target: { value: "typed-new-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(patches(spy)).toHaveLength(1));
    expect(bodyOf(patches(spy)[0]!)).toEqual({ smtpPass: "typed-new-value" });
    await waitFor(() => expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(""));
  });

  it("after a successful save the saved value becomes the new baseline (no phantom unsaved changes)", async () => {
    render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
    fireEvent.change(screen.getByLabelText(/Organisation name/), { target: { value: "Dept of Posts (HQ)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Saved/ })).toBeDisabled());
    expect(patches(spy)).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(/Organisation name/), { target: { value: "Dept of Posts" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(patches(spy)).toHaveLength(2));
    expect(bodyOf(patches(spy)[1]!)).toEqual({ orgName: "Dept of Posts" });
  });

  it("a failed read of the settings shows an error with Retry and NO form, so Save cannot overwrite unseen values", () => {
    render(<SystemSettingsClient tenant={hidden} settings={{ state: "error", forbidden: false }} />);
    expect(screen.queryByLabelText(/Organisation name/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0);
  });

  it("a forbidden read is a permission message, not a retry", () => {
    render(<SystemSettingsClient tenant={hidden} settings={{ state: "error", forbidden: true }} />);
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("mapAdminSettings turns the route payload into the form model and rejects a non-settings body", () => {
    const m = mapAdminSettings({ data: { general: section({ orgName: "A" }), email: section({ hasPassword: true }), security: section({}), integrations: section({}), logo: { present: true, contentType: "image/png", sizeBytes: 10 } } });
    expect(m?.hasSmtpPassword).toBe(true);
    expect(m?.logo).toEqual({ present: true, contentType: "image/png", sizeBytes: 10 });
    expect(mapAdminSettings({ data: [] })).toBeNull();
    expect(mapAdminSettings({})).toBeNull();
  });

  it("changedFields ignores unchanged values and an empty password, and keeps a typed one", () => {
    expect(changedFields({ a: "1", smtpPass: "" }, { a: "1", smtpPass: "" })).toEqual({});
    expect(changedFields({ a: "1", smtpPass: "" }, { a: "2", smtpPass: "pw" })).toEqual({ a: "2", smtpPass: "pw" });
  });

  // GAP-ADMIN-SETTINGS-03
  it("rejects a bad CIDR and an emptied timeout: per-field errors, no request", async () => {
    render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));
    fireEvent.change(screen.getByLabelText(/IP whitelist/), { target: { value: "10.0.0.0/33" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/not a valid CIDR range/)).toBeInTheDocument();
    expect(patches(spy)).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/IP whitelist/), { target: { value: "10.0.0.0/8\n192.168.1.0/24" } });
    fireEvent.change(screen.getByLabelText(/Session timeout/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Enter 5-480")).toBeInTheDocument();
    expect(patches(spy)).toHaveLength(0);
  });

  it("a non-empty allow-list opens the lockout warning before anything is sent", async () => {
    render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));
    fireEvent.change(screen.getByLabelText(/IP whitelist/), { target: { value: "10.0.0.0/8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/your own IP address is included/)).toBeInTheDocument();
    expect(patches(spy)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save security settings" }));
    await waitFor(() => expect(patches(spy)).toHaveLength(1));
    expect(bodyOf(patches(spy)[0]!)).toEqual({ ipWhitelist: "10.0.0.0/8" });
  });

  // GAP-ADMIN-SETTINGS-02
  it("the Tenant Config tab is absent for non-platform staff", () => {
    render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
    expect(screen.queryByRole("tab", { name: "Tenant Config" })).not.toBeInTheDocument();
  });

  it("platform staff see the real tenant record, with none of the old hard-coded strings", () => {
    render(<SystemSettingsClient tenant={{ state: "ready", name: "Dept of Posts", domain: "posts.gov.in", edition: "pro", status: "active", region: "ap-south-1" }} settings={ready()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Tenant Config" }));
    expect(screen.getAllByText("Dept of Posts").length).toBeGreaterThan(0);
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
  });
  const platform = { state: "ready", name: "N", domain: "d", edition: "e", status: "s", region: "r" } as const;

  it("keeps an edit and its dirty marker when switching tabs and back", () => {
    render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Email" }));
    fireEvent.change(screen.getByLabelText(/SMTP host/), { target: { value: "mail.example.gov.in" } });
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));
    expect(screen.getByRole("tab", { name: /Email.*unsaved changes/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Email/ }));
    expect((screen.getByLabelText(/SMTP host/) as HTMLInputElement).value).toBe("mail.example.gov.in");
  });

  it("registers a beforeunload guard only while a section is dirty", () => {
    const add = vi.spyOn(window, "addEventListener");
    render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
    expect(add.mock.calls.some(([t]) => t === "beforeunload")).toBe(false);
    fireEvent.change(screen.getByLabelText(/Organisation name/), { target: { value: "X" } });
    expect(add.mock.calls.some(([t]) => t === "beforeunload")).toBe(true);
  });

  it("arrow keys move selection with a roving tabindex; the panel is labelled by its tab", () => {
    render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
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
    const { unmount } = render(<SystemSettingsClient tenant={platform} settings={ready()} />);
    expect(screen.getByText(/General, Email, Security, Integrations, and Tenant Config/)).toBeInTheDocument();
    unmount();
    render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
    expect(screen.getByText(/General, Email, Security, and Integrations/)).toBeInTheDocument();
  });

  // GAP-ADMIN-SETTINGS-05
  describe("logo", () => {
    const pick = (file: File) => {
      const input = screen.getByLabelText("Logo") as HTMLInputElement;
      fireEvent.change(input, { target: { files: [file] } });
    };
    const png = (bytes = 100) => new File([new Uint8Array(bytes)], "logo.png", { type: "image/png" });

    it("is a real, labelled file input limited to PNG/JPEG, not a dead drop zone", () => {
      render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
      const input = screen.getByLabelText("Logo");
      expect(input).toHaveAttribute("type", "file");
      expect(input).toHaveAttribute("accept", "image/png,image/jpeg");
      expect(screen.queryByText(/logo upload is not available yet/i)).not.toBeInTheDocument();
    });

    it("rejects a wrong type or an oversize file with a message and sends nothing", () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
      render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
      pick(new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }));
      expect(screen.getByRole("alert")).toHaveTextContent("PNG or JPEG");
      pick(png(LOGO_MAX_BYTES + 1));
      expect(screen.getByRole("alert")).toHaveTextContent("too large");
      expect(fetchSpy.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
    });

    it("uploads the file as base64 JSON and shows a preview; logoUrl never goes in a settings PATCH", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
      render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
      pick(png(8));
      await waitFor(() => expect(screen.getByAltText("Current organisation logo")).toBeInTheDocument());
      const post = fetchSpy.mock.calls.find(([u, i]) => String(u).endsWith("/settings/logo") && (i as RequestInit | undefined)?.method === "POST")!;
      const body = JSON.parse((post[1] as RequestInit).body as string);
      expect(body.contentType).toBe("image/png");
      expect(body.dataBase64).toBe("AAAAAAAAAAA=");
      fireEvent.change(screen.getByLabelText(/Organisation name/), { target: { value: "Office" } });
      fireEvent.click(screen.getAllByRole("button", { name: /save changes/i })[0]!);
      await waitFor(() => expect(patches(fetchSpy as MockInstance<typeof fetch>)).toHaveLength(1));
      expect(bodyOf(patches(fetchSpy as MockInstance<typeof fetch>)[0]!)).toEqual({ orgName: "Office" });
    });

    it("a refused upload says so in plain language and keeps the old logo state", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 422 }));
      render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
      pick(png(8));
      expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t save your logo/i);
      expect(screen.getByText("No logo uploaded.")).toBeInTheDocument();
    });

    it("Remove asks first, then deletes", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (u, i) =>
        (i as RequestInit | undefined)?.method === "DELETE" ? new Response("{}", { status: 202 }) : new Response(JSON.stringify({ data: { contentType: "image/png", dataBase64: "AAAA" } }), { status: 200 }));
      render(<SystemSettingsClient tenant={hidden} settings={ready({ logo: { present: true, contentType: "image/png", sizeBytes: 3 } })} />);
      await screen.findByAltText("Current organisation logo");
      fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
      const dialog = await screen.findByRole("alertdialog");
      expect(fetchSpy.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "DELETE")).toBe(false);
      fireEvent.click(within(dialog).getByRole("button", { name: "Remove logo" }));
      await waitFor(() => expect(screen.getByText("No logo uploaded.")).toBeInTheDocument());
      expect(fetchSpy.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "DELETE")).toBe(true);
    });

    it("logoProblem: type, size and empty", () => {
      expect(logoProblem({ type: "image/png", size: 10 })).toBeNull();
      expect(logoProblem({ type: "image/gif", size: 10 })).toBe("type");
      expect(logoProblem({ type: "image/jpeg", size: LOGO_MAX_BYTES })).toBeNull();
      expect(logoProblem({ type: "image/jpeg", size: LOGO_MAX_BYTES + 1 })).toBe("size");
      expect(logoProblem({ type: "image/png", size: 0 })).toBe("empty");
    });
  });

  // GAP-ADMIN-SETTINGS-06
  describe("test email", () => {
    const open = () => {
      render(<SystemSettingsClient tenant={hidden} settings={ready()} />);
      fireEvent.click(screen.getByRole("tab", { name: "Email" }));
    };
    const send = () => fireEvent.click(screen.getByRole("button", { name: "Send test email" }));

    it("needs a valid recipient and says exactly what the test proves (platform sender + saved settings, not your own SMTP)", () => {
      open();
      expect(screen.getByRole("button", { name: "Send test email" })).toBeDisabled();
      const explain = screen.getByText(/through the platform email sender/);
      expect(explain).toHaveTextContent(/confirms the platform sender works and that SMTP settings are saved/);
      expect(explain).toHaveTextContent(/does not send through your own SMTP server/);
      fireEvent.change(screen.getByLabelText("Send a test email to"), { target: { value: "not-an-email" } });
      expect(screen.getByRole("button", { name: "Send test email" })).toBeDisabled();
    });

    it("posts the recipient and reports that the email was QUEUED, not that it arrived", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
      open();
      fireEvent.change(screen.getByLabelText("Send a test email to"), { target: { value: "me@dept.gov.in" } });
      send();
      expect(await screen.findByRole("status")).toHaveTextContent(/queued for me@dept\.gov\.in/);
      const post = fetchSpy.mock.calls.find(([u]) => String(u).endsWith("/email/test"))!;
      expect(bodyOf(post)).toEqual({ recipient: "me@dept.gov.in" });
    });

    it("a 409 tells the admin to save the SMTP host and From email first", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 409 }));
      open();
      fireEvent.change(screen.getByLabelText("Send a test email to"), { target: { value: "me@dept.gov.in" } });
      send();
      expect(await screen.findByRole("alert")).toHaveTextContent(/Save the SMTP host and the From email first/);
    });

    it("a 429 says to wait, with the limits", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 429 }));
      open();
      fireEvent.change(screen.getByLabelText("Send a test email to"), { target: { value: "me@dept.gov.in" } });
      send();
      expect(await screen.findByRole("alert")).toHaveTextContent(/Too many test emails.*one per minute per office, five per hour per administrator/);
    });

    it("any other failure is reported as a failure", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
      open();
      fireEvent.change(screen.getByLabelText("Send a test email to"), { target: { value: "me@dept.gov.in" } });
      send();
      expect(await screen.findByRole("alert")).toHaveTextContent(/could not be queued/);
    });
  });
});

// Hindi catalogue parity for this screen
describe("adminSettings catalogue", () => {
  it("hi has every en key with the same placeholders", async () => {
    const hi = (await import("@/messages/hi.json")).default as unknown as Record<string, Record<string, string>>;
    const en = enMessages as unknown as Record<string, Record<string, string>>;
    const ph = (v: string) => (v.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(",");
    expect(Object.keys(hi.adminSettings!).sort()).toEqual(Object.keys(en.adminSettings!).sort());
    for (const k of Object.keys(en.adminSettings!)) expect(ph(hi.adminSettings![k]!), k).toBe(ph(en.adminSettings![k]!));
  });
});
