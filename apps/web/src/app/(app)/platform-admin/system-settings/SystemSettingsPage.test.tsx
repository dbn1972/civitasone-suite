import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { SystemSettingsPage } from "./SystemSettingsPage";
import type { AdminSettings } from "@/app/_data/loaders";

function makeSettings(overrides: Partial<AdminSettings> = {}): AdminSettings {
  return {
    general: { configured: true, version: 1, values: { orgName: "Dept of Revenue", timezone: "Asia/Kolkata", currency: "INR", dateFormat: "dd/MM/yyyy" } },
    email: { configured: true, version: 1, values: { smtpHost: "smtp.example.in", smtpPort: 587, smtpUser: "no-reply@example.in", fromEmail: "no-reply@example.in", fromName: "Example" } },
    security: { configured: true, version: 1, values: { sessionTimeoutMin: 30, mfaRequired: true, ipWhitelist: [] } },
    integrations: { configured: true, version: 1, values: { pfmsUrl: "https://pfms.example.in", nicGatewayUrl: "", digiLockerEnabled: false, umangEnabled: false } },
    hasSmtpPassword: false,
    logo: { present: false, contentType: null, sizeBytes: null },
    ...overrides,
  };
}

describe("SystemSettingsPage (GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-01/02/04/05/06)", () => {
  beforeEach(() => vi.restoreAllMocks());

  // SYSTEM-SETTINGS-01/05: the form is seeded from the loaded settings, not
  // from DEFAULT_* constants.
  it("renders loaded values, not hardcoded defaults", () => {
    render(<SystemSettingsPage initial={makeSettings()} />);
    expect(screen.getByText("Dept of Revenue")).toBeInTheDocument();
    // The old fabricated "Government of India — Digital Services" default is gone.
    expect(screen.queryByText(/Government of India/)).not.toBeInTheDocument();
  });

  // SYSTEM-SETTINGS-01: saving PATCHes the real section with the edited value;
  // success only on res.ok.
  it("PATCHes the edited orgName in the body on save", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<SystemSettingsPage initial={makeSettings()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByLabelText("Organisation name"), { target: { value: "New Org" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText(/general settings saved/i)).toBeInTheDocument());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/admin/settings/general");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.orgName).toBe("New Org");
    expect(body.currency).toBe("INR");
  });

  // SYSTEM-SETTINGS-01: a failed save shows an error and no "saved" message
  // (no fakeSave, no 404 tolerance).
  it("shows an error and no success message when the save fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    render(<SystemSettingsPage initial={makeSettings()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText(/general settings saved/i)).not.toBeInTheDocument();
  });

  // SYSTEM-SETTINGS-01: a 404 is NOT tolerated as success anymore.
  it("treats a 404 as a real failure, not a silent success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    render(<SystemSettingsPage initial={makeSettings()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText(/general settings saved/i)).not.toBeInTheDocument();
  });

  // SYSTEM-SETTINGS-06: invalid session timeout blocks the save.
  it("blocks saving an out-of-range session timeout", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<SystemSettingsPage initial={makeSettings()} />);
    // Edit the Security section (3rd Edit button).
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[2]);
    fireEvent.change(screen.getByLabelText(/session timeout/i), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/between 5 and 480/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // SYSTEM-SETTINGS-06: currency no longer offers USD/EUR/GBP.
  it("does not offer non-INR currency options", () => {
    render(<SystemSettingsPage initial={makeSettings()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(screen.queryByRole("option", { name: "USD" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "EUR" })).not.toBeInTheDocument();
  });

  // SYSTEM-SETTINGS-02: turning MFA off requires a reason via confirm dialog.
  it("requires a reason before applying an MFA-off security change", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<SystemSettingsPage initial={makeSettings()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[2]);
    fireEvent.click(screen.getByLabelText(/require mfa/i)); // turn MFA off
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // Confirm dialog appears; no PATCH yet.
    expect(await screen.findByText(/apply security changes/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/reason for this security change/i), { target: { value: "disabling for migration" } });
    fireEvent.click(screen.getByRole("button", { name: /apply security settings/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.mfaRequired).toBe(false);
  });

  // SYSTEM-SETTINGS-04: the SMTP password is only sent when typed; blank omits it.
  it("omits smtpPass when the password field is left blank", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<SystemSettingsPage initial={makeSettings()} />);
    // Email is the 2nd Edit button.
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty("smtpPass");
  });

  // SYSTEM-SETTINGS-07: read mode renders text (a <dl>), not editable-looking
  // readonly text inputs.
  it("renders read-only values as text, not disabled input boxes", () => {
    const { container } = render(<SystemSettingsPage initial={makeSettings()} />);
    // Not editing: there should be no <input> rendered in the General card's read view.
    const generalCard = screen.getByText("General").closest(".card") as HTMLElement;
    expect(within(generalCard).queryByRole("textbox")).not.toBeInTheDocument();
    expect(container.querySelector("dl")).toBeTruthy();
  });
});
