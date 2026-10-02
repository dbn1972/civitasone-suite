"use client";
import { useState, useId } from "react";
import { Button, ConfirmDialog, PageHeader, Card } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import {
  SESSION_TIMEOUT_MIN,
  MAX_LOGIN_ATTEMPTS,
  PASSWORD_MIN_LEN,
  parseIpAllowlist,
  validateSecurityChanges,
  type SecurityFieldErrors,
} from "@/lib/validation/securitySettings";

// ── UX decisions (ux-auditor criteria applied) ───────────────────────────────
// 1. Tabbed layout: one mental model per tab, zero side-scroll cognitive load
// 2. Unsaved-change dot: immediate feedback signal without blocking modals
// 3. Per-section Save: granular control; avoids losing sibling-tab edits
// 4. Test-send button: closes the feedback loop for SMTP without leaving page
// 5. IP whitelist textarea: one-per-line hint, monospace for scannability
// 6. MFA toggle: confirmation step prevents accidental disablement
// 7. Storage progress bar: at-a-glance capacity signal for platform_admin
// 8. Reset Password disabled + tooltip: prevents bypassing Keycloak flow
// 9. All inputs have associated labels + aria attributes for screen readers
// 10. Loading / success / error states on every Save action
// ─────────────────────────────────────────────────────────────────────────────

const ALL_TABS = ["General", "Email", "Security", "Integrations", "Tenant Config"] as const;
type Tab = typeof ALL_TABS[number];

/** What the server page could establish about this office, for the platform-staff-only Tenant Config tab. */
export type TenantConfigData =
  | { state: "hidden" }
  | { state: "error"; forbidden: boolean }
  | { state: "ready"; name: string; domain: string; edition: string; status: string; region: string };

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * GAP-ADMIN-SETTINGS-01: there is no GET for these settings yet, so the form can
 * not know what is currently stored. It therefore starts BLANK (never with
 * invented defaults) and tracks which fields the admin actually edited; Save
 * sends only those fields. Untouched fields -- and an untyped SMTP password --
 * are never part of the request, so a save can no longer overwrite the real
 * server settings with seed values.
 */
function useSectionState<T extends Record<string, unknown>>(initial: T, area: string) {
  const [values, setValues] = useState<T>(initial);
  const [changed, setChanged] = useState<ReadonlySet<keyof T>>(new Set());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const formError = useFormError(area);

  function update(patch: Partial<T>) {
    setValues((prev) => ({ ...prev, ...patch }));
    setChanged((prev) => {
      const next = new Set(prev);
      for (const k of Object.keys(patch) as (keyof T)[]) next.add(k);
      return next;
    });
    setSaveState("idle");
    setLocalErrors({});
  }

  /** The edited fields only, with an empty password treated as "not provided". */
  function changedValues(): Partial<T> {
    const out: Partial<T> = {};
    for (const k of changed) {
      const v = values[k];
      if (k === "smtpPass" && (v === "" || v === undefined)) continue;
      out[k] = v;
    }
    return out;
  }

  const dirty = Object.keys(changedValues()).length > 0;

  async function save(endpoint: string, body: Record<string, unknown> = changedValues()) {
    if (Object.keys(body).length === 0) return;
    setSaveState("saving");
    formError.clear();
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        await formError.fromResponse(res, "save");
        setSaveState("error");
        return;
      }
      setSaveState("saved");
      setChanged(new Set());
      // A typed password must not linger in client state after it was sent.
      setValues((prev) => ("smtpPass" in prev ? { ...prev, smtpPass: "" } : prev));
    } catch {
      formError.fromException("save");
      setSaveState("error");
    }
  }

  const fieldError = (name: string) => localErrors[name] ?? formError.fieldError(name);

  return { values, update, dirty, saveState, save, formError, changedValues, setLocalErrors, fieldError };
}

/** Shown on every section: the form does not display stored values. */
function BlankFormNote() {
  return (
    <p role="note" style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>
      Current values are not shown on this screen. Fields you leave empty are not changed; only the fields you edit are saved.
    </p>
  );
}

function SaveButton({
  dirty,
  saveState,
  onSave,
  errorMessage,
}: {
  dirty: boolean;
  saveState: SaveState;
  onSave: () => void;
  errorMessage?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {dirty && <span title="Unsaved changes" aria-label="Unsaved changes" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />}
      <Button
        type="button"
        size="sm"
        disabled={!dirty || saveState === "saving"}
        onClick={onSave}
        loading={saveState === "saving"}
      >
        {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save changes"}
      </Button>
      {saveState === "error" && (
        <span role="alert" style={{ fontSize: 12, color: "#b42318" }}>{errorMessage}</span>
      )}
      {saveState === "saved" && (
        <span role="status" style={{ fontSize: 12, color: "#027a48" }}>Changes saved.</span>
      )}
    </div>
  );
}

function FieldRow({
  label,
  htmlFor,
  required,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label htmlFor={htmlFor} style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink2)" }}>
        {label}{required && <span aria-hidden="true" style={{ color: "#b42318", marginInlineStart: 2 }}>*</span>}
      </label>
      {children}
      {error && <span role="alert" style={{ fontSize: 12, color: "#b42318" }}>{error}</span>}
    </div>
  );
}

const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13.5, fontFamily: "inherit", color: "var(--ink)", background: "var(--panel)" };

// ── GENERAL TAB ──────────────────────────────────────────────────────────────
function GeneralSection() {
  const id = useId();
  const { values, update, dirty, saveState, save, formError, fieldError } = useSectionState(
    {
      orgName: "",
      logoUrl: "",
      timezone: "",
      currency: "",
      dateFormat: "",
      fiscalYearStart: "",
    },
    "general settings",
  );

  return (
    <Card>
      <div className="pad" style={{ display: "grid", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>General Settings</h3>
          <SaveButton dirty={dirty} saveState={saveState} onSave={() => void save("/api/proxy/v1/admin/settings/general")} errorMessage={formError.message} />
        </div>
        <BlankFormNote />
        <FieldRow label="Organisation name" htmlFor={`${id}-orgName`} error={fieldError("orgName")}>
          <input id={`${id}-orgName`} value={values.orgName} onChange={(e) => update({ orgName: e.target.value })} style={inp} />
        </FieldRow>
        <FieldRow label="Logo" htmlFor={`${id}-logo`} error={formError.fieldError("logoUrl")}>
          <div style={{ border: "2px dashed var(--line)", borderRadius: 10, padding: "24px 16px", textAlign: "center", cursor: "pointer", background: "var(--line2)" }}>
            <span style={{ fontSize: 28 }}>🖼️</span>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink2)" }}>Drop PNG/SVG here or <span style={{ color: "var(--primary)", textDecoration: "underline", cursor: "pointer" }}>browse</span></p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--mut)" }}>Max 2 MB — 200×200 px minimum</p>
            <input id={`${id}-logo`} type="file" accept="image/png,image/svg+xml" aria-label="Upload organisation logo" style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} onChange={(e) => { const f = e.target.files?.[0]; if (f) update({ logoUrl: f.name }); }} />
          </div>
        </FieldRow>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <FieldRow label="Timezone" htmlFor={`${id}-tz`} error={formError.fieldError("timezone")}>
            <select id={`${id}-tz`} value={values.timezone} onChange={(e) => update({ timezone: e.target.value })} style={inp}>
              <option value="">Unchanged</option>
              <option value="Asia/Kolkata">IST (Asia/Kolkata) +05:30</option>
              <option value="UTC">UTC +00:00</option>
            </select>
          </FieldRow>
          <FieldRow label="Currency" htmlFor={`${id}-curr`} error={formError.fieldError("currency")}>
            <select id={`${id}-curr`} value={values.currency} onChange={(e) => update({ currency: e.target.value })} style={inp}>
              <option value="">Unchanged</option>
              <option value="INR">INR — Indian Rupee (₹)</option>
              <option value="USD">USD — US Dollar ($)</option>
            </select>
          </FieldRow>
          <FieldRow label="Date format" htmlFor={`${id}-df`} error={formError.fieldError("dateFormat")}>
            <select id={`${id}-df`} value={values.dateFormat} onChange={(e) => update({ dateFormat: e.target.value })} style={inp}>
              <option value="">Unchanged</option>
              <option value="dd/MM/yyyy">dd/MM/yyyy (GFR 2017)</option>
              <option value="yyyy-MM-dd">yyyy-MM-dd (ISO 8601)</option>
            </select>
          </FieldRow>
          <FieldRow label="Fiscal year starts" htmlFor={`${id}-fy`} error={formError.fieldError("fiscalYearStart")}>
            <select id={`${id}-fy`} value={values.fiscalYearStart} onChange={(e) => update({ fiscalYearStart: e.target.value })} style={inp}>
              <option value="">Unchanged</option>
              <option value="04">April (Government of India)</option>
              <option value="01">January</option>
            </select>
          </FieldRow>
        </div>
      </div>
    </Card>
  );
}

// ── EMAIL TAB ────────────────────────────────────────────────────────────────
function EmailSection() {
  const id = useId();
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "ok" | "fail">("idle");
  const { values, update, dirty, saveState, save, formError, fieldError } = useSectionState(
    {
      smtpHost: "",
      smtpPort: "",
      smtpUser: "",
      // Write-only: never sent unless the admin types a new one.
      smtpPass: "",
      fromName: "",
      fromEmail: "",
      useTls: false,
    },
    "email settings",
  );

  async function sendTest() {
    setTestStatus("sending");
    try {
      const res = await fetch("/api/proxy/v1/admin/settings/email/test", { method: "POST" });
      setTestStatus(res.ok ? "ok" : "fail");
    } catch {
      setTestStatus("fail");
    }
    setTimeout(() => setTestStatus("idle"), 4000);
  }

  return (
    <Card>
      <div className="pad" style={{ display: "grid", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Email (SMTP)</h3>
          <SaveButton dirty={dirty} saveState={saveState} onSave={() => void save("/api/proxy/v1/admin/settings/email")} errorMessage={formError.message} />
        </div>
        <BlankFormNote />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 16 }}>
          <FieldRow label="SMTP host" htmlFor={`${id}-host`} error={fieldError("smtpHost")}>
            <input id={`${id}-host`} value={values.smtpHost} onChange={(e) => update({ smtpHost: e.target.value })} placeholder="smtp.nic.in" style={inp} />
          </FieldRow>
          <FieldRow label="Port" htmlFor={`${id}-port`} error={fieldError("smtpPort")}>
            <input id={`${id}-port`} value={values.smtpPort} onChange={(e) => update({ smtpPort: e.target.value })} placeholder="587" type="number" min={1} max={65535} style={inp} />
          </FieldRow>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <FieldRow label="Username" htmlFor={`${id}-user`} error={formError.fieldError("smtpUser")}>
            <input id={`${id}-user`} value={values.smtpUser} onChange={(e) => update({ smtpUser: e.target.value })} style={inp} />
          </FieldRow>
          <FieldRow label="Password" htmlFor={`${id}-pass`} error={formError.fieldError("smtpPass")}>
            <input id={`${id}-pass`} type="password" value={values.smtpPass} onChange={(e) => update({ smtpPass: e.target.value })} placeholder="Unchanged — type to replace" style={inp} autoComplete="new-password" />
          </FieldRow>
          <FieldRow label="From name" htmlFor={`${id}-fname`} error={formError.fieldError("fromName")}>
            <input id={`${id}-fname`} value={values.fromName} onChange={(e) => update({ fromName: e.target.value })} style={inp} />
          </FieldRow>
          <FieldRow label="From email" htmlFor={`${id}-femail`} error={formError.fieldError("fromEmail")}>
            <input id={`${id}-femail`} type="email" value={values.fromEmail} onChange={(e) => update({ fromEmail: e.target.value })} style={inp} />
          </FieldRow>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13.5 }}>
          <input type="checkbox" checked={values.useTls} onChange={(e) => update({ useTls: e.target.checked })} style={{ width: 16, height: 16, cursor: "pointer" }} />
          Use STARTTLS / TLS (applies only if you tick it)
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button type="button" variant="ghost" size="sm" onClick={() => void sendTest()} loading={testStatus === "sending"}>
            {testStatus === "sending" ? "Sending…" : "Send test email"}
          </Button>
          {testStatus === "ok" && <span role="status" style={{ fontSize: 12, color: "#027a48" }}>Test email sent.</span>}
          {testStatus === "fail" && <span role="alert" style={{ fontSize: 12, color: "#b42318" }}>Send failed — check credentials.</span>}
        </div>
      </div>
    </Card>
  );
}

// ── SECURITY TAB ─────────────────────────────────────────────────────────────
function SecuritySection() {
  const id = useId();
  const [mfaConfirm, setMfaConfirm] = useState(false);
  const [pendingBody, setPendingBody] = useState<Record<string, unknown> | null>(null);
  const { values, update, dirty, saveState, save, formError, changedValues, setLocalErrors, fieldError } = useSectionState(
    {
      // Numeric inputs stay strings so an emptied field is "empty", never 0.
      sessionTimeoutMin: "",
      maxLoginAttempts: "",
      passwordMinLen: "",
      mfaRequired: true,
      ipWhitelist: "",
    },
    "security settings",
  );

  function handleMfaToggle(checked: boolean) {
    if (!checked) { setMfaConfirm(true); return; }
    update({ mfaRequired: true });
  }

  // GAP-ADMIN-SETTINGS-03: validate before anything is sent; GAP-ADMIN-SETTINGS-01: confirm first.
  function requestSave() {
    const changed = changedValues();
    const { mfaRequired, ...stringFields } = changed;
    const result = validateSecurityChanges(stringFields as Parameters<typeof validateSecurityChanges>[0]);
    if (!result.ok) {
      setLocalErrors(result.errors as SecurityFieldErrors as Record<string, string>);
      return;
    }
    setLocalErrors({});
    setPendingBody({ ...result.data, ...(mfaRequired !== undefined ? { mfaRequired } : {}) });
  }

  const lockoutRisk = pendingBody !== null && typeof pendingBody.ipWhitelist === "string" && parseIpAllowlist(pendingBody.ipWhitelist).length > 0;

  return (
    <Card>
      <div className="pad" style={{ display: "grid", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Security</h3>
          <SaveButton dirty={dirty} saveState={saveState} onSave={requestSave} errorMessage={formError.message} />
        </div>
        <BlankFormNote />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <FieldRow label={`Session timeout (minutes, ${SESSION_TIMEOUT_MIN.min}-${SESSION_TIMEOUT_MIN.max})`} htmlFor={`${id}-sto`} error={fieldError("sessionTimeoutMin")}>
            <input id={`${id}-sto`} type="number" inputMode="numeric" min={SESSION_TIMEOUT_MIN.min} max={SESSION_TIMEOUT_MIN.max} value={values.sessionTimeoutMin} onChange={(e) => update({ sessionTimeoutMin: e.target.value })} style={inp} />
          </FieldRow>
          <FieldRow label={`Max login attempts (${MAX_LOGIN_ATTEMPTS.min}-${MAX_LOGIN_ATTEMPTS.max})`} htmlFor={`${id}-mla`} error={fieldError("maxLoginAttempts")}>
            <input id={`${id}-mla`} type="number" inputMode="numeric" min={MAX_LOGIN_ATTEMPTS.min} max={MAX_LOGIN_ATTEMPTS.max} value={values.maxLoginAttempts} onChange={(e) => update({ maxLoginAttempts: e.target.value })} style={inp} />
          </FieldRow>
          <FieldRow label={`Minimum password length (${PASSWORD_MIN_LEN.min}-${PASSWORD_MIN_LEN.max})`} htmlFor={`${id}-pwlen`} error={fieldError("passwordMinLen")}>
            <input id={`${id}-pwlen`} type="number" inputMode="numeric" min={PASSWORD_MIN_LEN.min} max={PASSWORD_MIN_LEN.max} value={values.passwordMinLen} onChange={(e) => update({ passwordMinLen: e.target.value })} style={inp} />
          </FieldRow>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label htmlFor={`${id}-mfa`} style={{ fontSize: 13.5, fontWeight: 550, cursor: "pointer" }}>
            Require MFA for all users
          </label>
          <input id={`${id}-mfa`} type="checkbox" role="switch" checked={values.mfaRequired} onChange={(e) => handleMfaToggle(e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
        </div>
        {mfaConfirm && (
          <div role="alertdialog" aria-modal="true" style={{ background: "var(--warn-bg, #fffbeb)", border: "1px solid var(--warn-bd, #fcd34d)", borderRadius: 10, padding: "14px 16px", display: "grid", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>Disable MFA enforcement?</p>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>Disabling MFA reduces platform security. All users will no longer be required to authenticate with a second factor.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <Button type="button" variant="danger" size="sm" onClick={() => { update({ mfaRequired: false }); setMfaConfirm(false); }}>Yes, disable MFA</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setMfaConfirm(false)}>Cancel</Button>
            </div>
          </div>
        )}
        <FieldRow label="IP whitelist (one CIDR per line)" htmlFor={`${id}-ip`} error={fieldError("ipWhitelist")}>
          <textarea id={`${id}-ip`} rows={4} value={values.ipWhitelist} onChange={(e) => update({ ipWhitelist: e.target.value })} placeholder={"10.0.0.0/8\n192.168.1.0/24"} style={{ ...inp, resize: "vertical", fontFamily: "monospace", fontSize: 13 }} aria-describedby={`${id}-ip-hint`} />
          <p id={`${id}-ip-hint`} style={{ margin: "4px 0 0", fontSize: 11.5, color: "var(--mut)" }}>Enter one CIDR range per line (for example 10.0.0.0/8). Saving an empty list allows all IPs.</p>
        </FieldRow>
      </div>
      <ConfirmDialog
        open={pendingBody !== null}
        danger={lockoutRisk}
        title="Save security settings?"
        description={
          <div>
            <p style={{ margin: "0 0 8px" }}>These changes apply to everyone signing in to this office.</p>
            {lockoutRisk && (
              <p style={{ margin: 0 }}>
                <strong>Make sure your own IP address is included in the allow-list.</strong> If it is not, you and every other user outside these ranges will be locked out.
              </p>
            )}
          </div>
        }
        confirmLabel="Save security settings"
        busy={saveState === "saving"}
        onConfirm={() => { const body = pendingBody; setPendingBody(null); if (body) void save("/api/proxy/v1/admin/settings/security", body); }}
        onCancel={() => setPendingBody(null)}
      />
    </Card>
  );
}

// ── INTEGRATIONS TAB ─────────────────────────────────────────────────────────
function IntegrationsSection() {
  const id = useId();
  const { values, update, dirty, saveState, save, formError, fieldError } = useSectionState(
    {
      pfmsUrl: "",
      nicGatewayUrl: "",
      digiLockerEnabled: false,
      umangEnabled: false,
    },
    "integrations settings",
  );

  return (
    <Card>
      <div className="pad" style={{ display: "grid", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Integrations</h3>
          <SaveButton dirty={dirty} saveState={saveState} onSave={() => void save("/api/proxy/v1/admin/settings/integrations")} errorMessage={formError.message} />
        </div>
        <BlankFormNote />
        <FieldRow label="PFMS base URL" htmlFor={`${id}-pfms`} error={fieldError("pfmsUrl")}>
          <input id={`${id}-pfms`} type="url" value={values.pfmsUrl} onChange={(e) => update({ pfmsUrl: e.target.value })} style={inp} />
        </FieldRow>
        <FieldRow label="NIC Gateway URL" htmlFor={`${id}-nic`} error={formError.fieldError("nicGatewayUrl")}>
          <input id={`${id}-nic`} type="url" value={values.nicGatewayUrl} onChange={(e) => update({ nicGatewayUrl: e.target.value })} style={inp} />
        </FieldRow>
        <fieldset style={{ border: "none", margin: 0, padding: 0, display: "grid", gap: 14 }}>
          <legend style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink2)", marginBottom: 8 }}>Third-party integrations</legend>
          {([
            { key: "digiLockerEnabled" as const, label: "DigiLocker", desc: "Allow document verification via DigiLocker (MeitY)" },
            { key: "umangEnabled" as const, label: "UMANG", desc: "Enable UMANG portal single sign-on" },
          ] as const).map(({ key, label, desc }) => (
            <label key={key} style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
              <input type="checkbox" id={`${id}-${key}`} role="switch" checked={values[key]} onChange={(e) => update({ [key]: e.target.checked } as Record<string, boolean>)} style={{ width: 16, height: 16, cursor: "pointer", marginTop: 2, flexShrink: 0 }} />
              <span>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 550 }}>{label}</span>
                <span style={{ display: "block", fontSize: 12, color: "var(--mut)" }}>{desc}</span>
              </span>
              {values[key] && <span className="pill good" style={{ fontSize: 11, flexShrink: 0 }}>Active</span>}
            </label>
          ))}
        </fieldset>
      </div>
    </Card>
  );
}

// ── TENANT CONFIG TAB (platform staff only) ──────────────────────────────────
function TenantConfigSection({ tenant }: { tenant: TenantConfigData }) {
  // GAP-ADMIN-SETTINGS-02: values come from the real tenant record
  // (GET /v1/admin/tenants/:id), never from constants. Realm / DB schema /
  // storage figures are not exposed by any endpoint, so they are not shown.
  return (
    <Card>
      <div className="pad" style={{ display: "grid", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Tenant Configuration</h3>
          <span className="pill info" style={{ fontSize: 11 }}>Read-only — platform_admin</span>
        </div>
        {tenant.state === "ready" ? (
          <>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--mut)" }}>Details managed by the CivitasOne platform team. Contact support to change these values.</p>
            {([
              { label: "Tenant name", value: tenant.name },
              { label: "Domain", value: tenant.domain },
              { label: "Edition", value: tenant.edition },
              { label: "Status", value: tenant.status },
              { label: "Region", value: tenant.region },
            ] as const).map(({ label, value }) => (
              <div key={label} style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink2)" }}>{label}</span>
                <span style={{ fontSize: 13.5 }}>{value || "—"}</span>
              </div>
            ))}
          </>
        ) : (
          <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
            {tenant.state === "error" && tenant.forbidden
              ? "Your account is not permitted to view tenant configuration."
              : "Tenant configuration is not available right now."}
          </p>
        )}
      </div>
    </Card>
  );
}

// ── PAGE ─────────────────────────────────────────────────────────────────────
export function SystemSettingsClient({ tenant }: { tenant: TenantConfigData }) {
  const [activeTab, setActiveTab] = useState<Tab>("General");
  // The Tenant Config tab exists only for platform staff (the server page decides).
  const TABS = ALL_TABS.filter((t) => t !== "Tenant Config" || tenant.state !== "hidden");

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="System Settings"
        subtitle="Platform-wide configuration — General, Email, Security, and Integrations."
        back="/admin"
      />
      <div className="tabs" role="tablist" aria-label="Settings sections" style={{ marginBottom: 20 }}>
        {TABS.map((tab) => (
          <span
            key={tab}
            className={activeTab === tab ? "on" : undefined}
            role="tab"
            aria-selected={activeTab === tab}
            tabIndex={0}
            onClick={() => setActiveTab(tab)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveTab(tab); } }}
          >
            {tab}
          </span>
        ))}
      </div>
      <div role="tabpanel" aria-label={activeTab}>
        {activeTab === "General" && <GeneralSection />}
        {activeTab === "Email" && <EmailSection />}
        {activeTab === "Security" && <SecuritySection />}
        {activeTab === "Integrations" && <IntegrationsSection />}
        {activeTab === "Tenant Config" && tenant.state !== "hidden" && <TenantConfigSection tenant={tenant} />}
      </div>
    </div>
  );
}
