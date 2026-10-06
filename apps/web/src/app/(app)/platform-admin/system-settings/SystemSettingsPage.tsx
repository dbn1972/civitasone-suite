"use client";

import { useId, useState } from "react";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";
import type { AdminSettings } from "@/app/_data/loaders";

/* ─── Types mirror the admin-service tenant-settings PATCH contract ─────── */
type GeneralSettings = { orgName: string; timezone: "Asia/Kolkata" | "UTC"; currency: "INR"; dateFormat: "dd/MM/yyyy" | "yyyy-MM-dd" };
type EmailSettings = { smtpHost: string; smtpPort: string; smtpUser: string; fromEmail: string; fromName: string; useTls: boolean };
type SecuritySettings = { sessionTimeoutMin: string; mfaRequired: boolean; ipWhitelist: string };
type IntegrationSettings = { pfmsUrl: string; nicGatewayUrl: string; digiLockerEnabled: boolean; umangEnabled: boolean };

const TIMEZONES: GeneralSettings["timezone"][] = ["Asia/Kolkata", "UTC"];

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}
function bool(v: unknown): boolean {
  return v === true;
}
function strList(v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join("\n");
  return typeof v === "string" ? v : "";
}

function initialGeneral(s: AdminSettings): GeneralSettings {
  const v = s.general.values;
  const tz = str(v.timezone) === "UTC" ? "UTC" : "Asia/Kolkata";
  const df = str(v.dateFormat) === "yyyy-MM-dd" ? "yyyy-MM-dd" : "dd/MM/yyyy";
  return { orgName: str(v.orgName), timezone: tz, currency: "INR", dateFormat: df };
}
function initialEmail(s: AdminSettings): EmailSettings {
  const v = s.email.values;
  return { smtpHost: str(v.smtpHost), smtpPort: str(v.smtpPort), smtpUser: str(v.smtpUser), fromEmail: str(v.fromEmail), fromName: str(v.fromName), useTls: v.useTls !== false };
}
function initialSecurity(s: AdminSettings): SecuritySettings {
  const v = s.security.values;
  return { sessionTimeoutMin: str(v.sessionTimeoutMin, ""), mfaRequired: bool(v.mfaRequired), ipWhitelist: strList(v.ipWhitelist) };
}
function initialIntegrations(s: AdminSettings): IntegrationSettings {
  const v = s.integrations.values;
  return { pfmsUrl: str(v.pfmsUrl), nicGatewayUrl: str(v.nicGatewayUrl), digiLockerEnabled: bool(v.digiLockerEnabled), umangEnabled: bool(v.umangEnabled) };
}

/* ─── Section card ──────────────────────────────────────────────────── */
function SectionCard({ title, editing, onEdit, onSave, onCancel, busy, error, children }: {
  title: string; editing: boolean; onEdit: () => void; onSave: () => void; onCancel: () => void; busy: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3 style={{ margin: 0 }}>{title}</h3>
        {editing ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={onSave} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
        )}
      </div>
      {error ? <p role="alert" style={{ fontSize: 12.5, color: "var(--bad, #b42318)", margin: 0, padding: "6px 16px 0" }}>{error}</p> : null}
      <div style={{ padding: "16px" }}>{children}</div>
    </div>
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 650, color: "var(--ink2)", marginBottom: 4 };
const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13.5, fontFamily: "inherit", color: "var(--ink)", boxSizing: "border-box" as const };
const row: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 };
const fullRow: React.CSSProperties = { marginBottom: 16 };
const roText: React.CSSProperties = { fontSize: 13.5, color: "var(--ink)" };

// GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-07: in read mode render a <dl> of
// label/value TEXT, not disabled-looking <input readOnly> boxes that screen
// readers announce as editable fields.
function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={lbl}>{label}</dt>
      <dd style={{ ...roText, margin: 0 }}>{value || "—"}</dd>
    </div>
  );
}

function settingsSaveError(): string {
  const human = toHumanError("save", { area: "settings" });
  return `${human.what} ${human.next}`;
}

type Section = "general" | "email" | "security" | "integrations";

export function SystemSettingsPage({ initial }: { initial: AdminSettings }) {
  const [general, setGeneral] = useState<GeneralSettings>(() => initialGeneral(initial));
  const [email, setEmail] = useState<EmailSettings>(() => initialEmail(initial));
  const [smtpPassword, setSmtpPassword] = useState(""); // never seeded from the server; blank = keep existing
  const [security, setSecurity] = useState<SecuritySettings>(() => initialSecurity(initial));
  const [integrations, setIntegrations] = useState<IntegrationSettings>(() => initialIntegrations(initial));

  const [editSection, setEditSection] = useState<Section | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMsg, setSuccessMsg] = useState("");
  const [securityConfirm, setSecurityConfirm] = useState(false);

  // GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-03: shared unsaved-changes guard.
  useUnsavedChangesGuard(editSection !== null);

  function startEdit(section: Section) {
    setEditSection(section);
    setErrors((e) => ({ ...e, [section]: "" }));
    setSuccessMsg("");
  }
  function cancelEdit(section: Section, reset: () => void) {
    reset();
    setEditSection(null);
    setErrors((e) => ({ ...e, [section]: "" }));
  }

  function validate(section: Section): string | null {
    if (section === "security") {
      const n = Number(security.sessionTimeoutMin);
      if (!Number.isInteger(n) || n < 5 || n > 480) return "Session timeout must be a whole number of minutes between 5 and 480.";
      // CIDR lines validated loosely client-side; the server enforces the real rule.
      const bad = security.ipWhitelist.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).find((l) => !/^[0-9a-fA-F:.]+\/\d{1,3}$/.test(l));
      if (bad) return `"${bad}" is not a valid CIDR range (e.g. 10.0.0.0/8).`;
    }
    if (section === "email") {
      const port = Number(email.smtpPort);
      if (email.smtpPort && (!Number.isInteger(port) || port < 1 || port > 65535)) return "SMTP port must be between 1 and 65535.";
    }
    return null;
  }

  function sectionBody(section: Section): Record<string, unknown> {
    if (section === "general") return { orgName: general.orgName, timezone: general.timezone, currency: general.currency, dateFormat: general.dateFormat };
    if (section === "email") {
      const body: Record<string, unknown> = { smtpHost: email.smtpHost, smtpPort: Number(email.smtpPort), smtpUser: email.smtpUser, fromEmail: email.fromEmail, fromName: email.fromName, useTls: email.useTls };
      // GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-04: only send the password if the
      // admin typed one; blank = keep existing. Never echo a stored secret.
      if (smtpPassword) body.smtpPass = smtpPassword;
      return body;
    }
    if (section === "security") {
      return {
        sessionTimeoutMin: Number(security.sessionTimeoutMin),
        mfaRequired: security.mfaRequired,
        ipWhitelist: security.ipWhitelist.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
      };
    }
    return { pfmsUrl: integrations.pfmsUrl, nicGatewayUrl: integrations.nicGatewayUrl, digiLockerEnabled: integrations.digiLockerEnabled, umangEnabled: integrations.umangEnabled };
  }

  async function doSave(section: Section) {
    const validationError = validate(section);
    if (validationError) { setErrors((e) => ({ ...e, [section]: validationError })); return; }
    setBusy(true);
    setErrors((e) => ({ ...e, [section]: "" }));
    try {
      // GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-01: real PATCH with the real body,
      // same verb/shape as the admin/settings sibling. No fakeSave, no 404/405
      // tolerance — every non-2xx surfaces as an error, never a fake "saved".
      const res = await fetch(`/api/proxy/v1/admin/settings/${section}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sectionBody(section)),
      });
      if (!res.ok) {
        setErrors((e) => ({ ...e, [section]: settingsSaveError() }));
        return;
      }
      setEditSection(null);
      if (section === "email") setSmtpPassword("");
      setSuccessMsg(`${section} settings saved.`);
    } catch {
      setErrors((e) => ({ ...e, [section]: settingsSaveError() }));
    } finally {
      setBusy(false);
    }
  }

  function saveSection(section: Section) {
    // GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-02: a security change that turns MFA
    // off or sets a non-empty IP allow-list is lock-out-sensitive — require an
    // explicit confirmation first.
    if (section === "security") {
      const risky = !security.mfaRequired || security.ipWhitelist.trim().length > 0;
      if (risky) { setSecurityConfirm(true); return; }
    }
    void doSave(section);
  }

  const gId = useId();
  const eId = useId();
  const sId = useId();
  const iId = useId();

  return (
    <div>
      {successMsg ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12.5, color: "var(--good, #027a48)", marginBottom: 12, padding: "8px 12px", background: "var(--goodbg, #ecfdf3)", borderRadius: 8 }}>
          {successMsg}
        </p>
      ) : null}

      {/* General */}
      <SectionCard title="General" editing={editSection === "general"} onEdit={() => startEdit("general")} onSave={() => saveSection("general")} onCancel={() => cancelEdit("general", () => setGeneral(initialGeneral(initial)))} busy={busy} error={errors["general"]}>
        {editSection === "general" ? (
          <>
            <div style={row}>
              <div>
                <label htmlFor={`${gId}-name`} style={lbl}>Organisation name</label>
                <input id={`${gId}-name`} style={inp} value={general.orgName} onChange={(e) => setGeneral((s) => ({ ...s, orgName: e.target.value }))} />
              </div>
              <div>
                <label htmlFor={`${gId}-tz`} style={lbl}>Timezone</label>
                <select id={`${gId}-tz`} style={inp} value={general.timezone} onChange={(e) => setGeneral((s) => ({ ...s, timezone: e.target.value as GeneralSettings["timezone"] }))}>
                  {TIMEZONES.map((tz) => <option key={tz}>{tz}</option>)}
                </select>
              </div>
            </div>
            <div style={row}>
              <div>
                {/* GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-06: currency is INR-only
                    (money is paise/₹ end to end; the formatters are INR-only).
                    Shown read-only rather than offering USD/EUR/GBP. */}
                <span style={lbl}>Currency</span>
                <p style={{ ...roText, margin: 0 }}>INR (₹) — fixed</p>
              </div>
              <div>
                <label htmlFor={`${gId}-df`} style={lbl}>Date format</label>
                <select id={`${gId}-df`} style={inp} value={general.dateFormat} onChange={(e) => setGeneral((s) => ({ ...s, dateFormat: e.target.value as GeneralSettings["dateFormat"] }))}>
                  <option value="dd/MM/yyyy">dd/MM/yyyy</option>
                  <option value="yyyy-MM-dd">yyyy-MM-dd</option>
                </select>
              </div>
            </div>
          </>
        ) : (
          <dl style={row}>
            <ReadField label="Organisation name" value={general.orgName} />
            <ReadField label="Timezone" value={general.timezone} />
            <ReadField label="Currency" value="INR (₹)" />
            <ReadField label="Date format" value={general.dateFormat} />
          </dl>
        )}
      </SectionCard>

      {/* Email */}
      <SectionCard title="Email (SMTP)" editing={editSection === "email"} onEdit={() => startEdit("email")} onSave={() => saveSection("email")} onCancel={() => cancelEdit("email", () => { setEmail(initialEmail(initial)); setSmtpPassword(""); })} busy={busy} error={errors["email"]}>
        {editSection === "email" ? (
          <>
            <div style={row}>
              <div>
                <label htmlFor={`${eId}-host`} style={lbl}>SMTP host</label>
                <input id={`${eId}-host`} style={inp} value={email.smtpHost} onChange={(e) => setEmail((s) => ({ ...s, smtpHost: e.target.value }))} />
              </div>
              <div>
                <label htmlFor={`${eId}-port`} style={lbl}>Port</label>
                <input id={`${eId}-port`} style={inp} type="number" min={1} max={65535} value={email.smtpPort} onChange={(e) => setEmail((s) => ({ ...s, smtpPort: e.target.value }))} />
              </div>
            </div>
            <div style={row}>
              <div>
                <label htmlFor={`${eId}-user`} style={lbl}>Username</label>
                <input id={`${eId}-user`} style={inp} value={email.smtpUser} onChange={(e) => setEmail((s) => ({ ...s, smtpUser: e.target.value }))} />
              </div>
              <div>
                {/* GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-04: controlled password
                    input; blank = keep existing; never populated from the API. */}
                <label htmlFor={`${eId}-pass`} style={lbl}>Password {initial.hasSmtpPassword ? <span style={{ fontWeight: 400, color: "var(--ink2)" }}>(leave blank to keep existing)</span> : null}</label>
                <input id={`${eId}-pass`} style={inp} type="password" autoComplete="new-password" placeholder={initial.hasSmtpPassword ? "••••••••" : ""} value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} />
              </div>
            </div>
            <div style={row}>
              <div>
                <label htmlFor={`${eId}-from`} style={lbl}>From address</label>
                <input id={`${eId}-from`} style={inp} value={email.fromEmail} onChange={(e) => setEmail((s) => ({ ...s, fromEmail: e.target.value }))} />
              </div>
              <div>
                <label htmlFor={`${eId}-fromname`} style={lbl}>From name</label>
                <input id={`${eId}-fromname`} style={inp} value={email.fromName} onChange={(e) => setEmail((s) => ({ ...s, fromName: e.target.value }))} />
              </div>
            </div>
          </>
        ) : (
          <dl style={row}>
            <ReadField label="SMTP host" value={email.smtpHost} />
            <ReadField label="Port" value={email.smtpPort} />
            <ReadField label="Username" value={email.smtpUser} />
            <ReadField label="Password" value={initial.hasSmtpPassword ? "Set" : "Not set"} />
            <ReadField label="From address" value={email.fromEmail} />
            <ReadField label="From name" value={email.fromName} />
          </dl>
        )}
      </SectionCard>

      {/* Security */}
      <SectionCard title="Security" editing={editSection === "security"} onEdit={() => startEdit("security")} onSave={() => saveSection("security")} onCancel={() => cancelEdit("security", () => setSecurity(initialSecurity(initial)))} busy={busy} error={errors["security"]}>
        {editSection === "security" ? (
          <>
            <div style={row}>
              <div>
                <label htmlFor={`${sId}-timeout`} style={lbl}>Session timeout (minutes)</label>
                <input id={`${sId}-timeout`} style={inp} type="number" min={5} max={480} value={security.sessionTimeoutMin} onChange={(e) => setSecurity((s) => ({ ...s, sessionTimeoutMin: e.target.value }))} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 22 }}>
                <label style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  <input type="checkbox" checked={security.mfaRequired} onChange={(e) => setSecurity((s) => ({ ...s, mfaRequired: e.target.checked }))} style={{ marginInlineEnd: 8, width: 16, height: 16 }} />
                  Require MFA for all users
                </label>
              </div>
            </div>
            <div style={fullRow}>
              <label htmlFor={`${sId}-ip`} style={lbl}>IP whitelist <span style={{ fontWeight: 400, color: "var(--ink2)" }}>(one CIDR per line, empty = allow all — include your own IP)</span></label>
              <textarea id={`${sId}-ip`} style={{ ...inp, minHeight: 80, resize: "vertical" }} value={security.ipWhitelist} placeholder="e.g. 10.0.0.0/8" onChange={(e) => setSecurity((s) => ({ ...s, ipWhitelist: e.target.value }))} />
            </div>
          </>
        ) : (
          <dl style={fullRow}>
            <div style={row}>
              <ReadField label="Session timeout" value={security.sessionTimeoutMin ? `${security.sessionTimeoutMin} min` : ""} />
              <ReadField label="MFA" value={security.mfaRequired ? "Required" : "Optional"} />
            </div>
            <ReadField label="IP whitelist" value={security.ipWhitelist ? security.ipWhitelist.split(/\r?\n/).filter(Boolean).join(", ") : "Allow all"} />
          </dl>
        )}
      </SectionCard>

      {/* Integrations */}
      <SectionCard title="Integrations" editing={editSection === "integrations"} onEdit={() => startEdit("integrations")} onSave={() => saveSection("integrations")} onCancel={() => cancelEdit("integrations", () => setIntegrations(initialIntegrations(initial)))} busy={busy} error={errors["integrations"]}>
        {editSection === "integrations" ? (
          <>
            <div style={fullRow}>
              <label htmlFor={`${iId}-pfms`} style={lbl}>PFMS API endpoint</label>
              <input id={`${iId}-pfms`} style={inp} value={integrations.pfmsUrl} placeholder="https://…" onChange={(e) => setIntegrations((s) => ({ ...s, pfmsUrl: e.target.value }))} />
            </div>
            <div style={fullRow}>
              <label htmlFor={`${iId}-nic`} style={lbl}>NIC gateway URL</label>
              <input id={`${iId}-nic`} style={inp} value={integrations.nicGatewayUrl} placeholder="https://…" onChange={(e) => setIntegrations((s) => ({ ...s, nicGatewayUrl: e.target.value }))} />
            </div>
            <div style={row}>
              <label style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                <input type="checkbox" checked={integrations.digiLockerEnabled} onChange={(e) => setIntegrations((s) => ({ ...s, digiLockerEnabled: e.target.checked }))} style={{ marginInlineEnd: 8, width: 16, height: 16 }} />
                DigiLocker enabled
              </label>
              <label style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                <input type="checkbox" checked={integrations.umangEnabled} onChange={(e) => setIntegrations((s) => ({ ...s, umangEnabled: e.target.checked }))} style={{ marginInlineEnd: 8, width: 16, height: 16 }} />
                UMANG enabled
              </label>
            </div>
          </>
        ) : (
          <dl style={fullRow}>
            <div style={row}>
              <ReadField label="PFMS API endpoint" value={integrations.pfmsUrl} />
              <ReadField label="NIC gateway URL" value={integrations.nicGatewayUrl} />
            </div>
            <div style={row}>
              <ReadField label="DigiLocker" value={integrations.digiLockerEnabled ? "Enabled" : "Disabled"} />
              <ReadField label="UMANG" value={integrations.umangEnabled ? "Enabled" : "Disabled"} />
            </div>
          </dl>
        )}
      </SectionCard>

      {/* Security confirmation (lock-out sensitive) */}
      <ConfirmDialog
        open={securityConfirm}
        title="Apply security changes?"
        description="Turning MFA off or applying an IP allow-list can lock users (including you) out. Make sure your own IP is included in the allow-list. Enter a reason to continue."
        confirmLabel="Apply security settings"
        requireReason
        reasonLabel="Reason for this security change"
        minReasonLength={5}
        danger
        busy={busy}
        onConfirm={() => { setSecurityConfirm(false); void doSave("security"); }}
        onCancel={() => setSecurityConfirm(false)}
      />
    </div>
  );
}
