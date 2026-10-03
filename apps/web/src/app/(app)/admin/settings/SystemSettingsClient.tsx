"use client";
import { useState, useId, useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, PageHeader, Card, RefreshErrorState } from "@/app/_components/ds";
import type { AdminSettings } from "@/app/_data/loaders";
import { toHumanError } from "@/lib/messages";
import {
  changedFields, emailForm, generalForm, integrationsForm, logoProblem, securityForm,
  LOGO_MAX_BYTES, LOGO_TYPES, type EmailForm, type GeneralForm, type IntegrationsForm, type SecurityForm,
} from "./settingsModel";
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

/** What the server page could read from GET /v1/admin/settings. A failed read makes the four forms read-only-by-absence: no form, no Save. */
export type SettingsLoad =
  | { state: "ready"; settings: AdminSettings }
  | { state: "error"; forbidden: boolean };

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * GAP-ADMIN-SETTINGS-01: every section starts from the STORED values (GET /v1/admin/settings)
 * and tracks which fields differ from them. Save sends only those fields, so saving one field can
 * never overwrite the rest of the server settings, and an untyped SMTP password is never sent.
 */
function useSectionState<T extends Record<string, unknown>>(loaded: T, area: string, onDirtyChange?: (dirty: boolean) => void) {
  const [baseline, setBaseline] = useState<T>(loaded);
  const [values, setValues] = useState<T>(loaded);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const formError = useFormError(area);

  function update(patch: Partial<T>) {
    setValues((prev) => ({ ...prev, ...patch }));
    setSaveState("idle");
    setLocalErrors({});
  }

  /** The edited fields only, with an empty password treated as "not provided". */
  function changedValues(): Partial<T> {
    return changedFields(baseline, values);
  }

  const dirty = Object.keys(changedValues()).length > 0;
  // GAP-ADMIN-SETTINGS-04: report unsaved edits up so the tab can show a marker and the page can warn on unload.
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => { onDirtyRef.current?.(dirty); }, [dirty]);

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
      // What was sent is now what is stored; a typed password must not linger in client state.
      const { smtpPass: _sent, ...stored } = body;
      void _sent;
      setBaseline((prev) => ({ ...prev, ...(stored as Partial<T>) }));
      setValues((prev) => ({ ...prev, ...(stored as Partial<T>), ...("smtpPass" in prev ? { smtpPass: "" } : {}) }));
    } catch (caught) {
      formError.fromException("save", caught);
      setSaveState("error");
    }
  }

  const fieldError = (name: string) => localErrors[name] ?? formError.fieldError(name);

  return { values, update, dirty, saveState, save, formError, changedValues, setLocalErrors, fieldError };
}

/** Shown when this section has never been saved: the empty fields are "no value yet", not a stored blank. */
function NotConfiguredNote({ configured }: { configured: boolean }) {
  const t = useTranslations("adminSettings");
  if (configured) return null;
  return (
    <p role="note" style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>
      {t("notConfigured")}
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
  const t = useTranslations("adminSettings");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {dirty && <span title={t("unsavedChangesTitle")} aria-label={t("unsavedChangesTitle")} style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />}
      <Button
        type="button"
        size="sm"
        disabled={!dirty || saveState === "saving"}
        onClick={onSave}
        loading={saveState === "saving"}
      >
        {saveState === "saving" ? t("saving") : saveState === "saved" ? t("saved") : t("saveChanges")}
      </Button>
      {saveState === "error" && (
        <span role="alert" style={{ fontSize: 12, color: "#b42318" }}>{errorMessage}</span>
      )}
      {saveState === "saved" && (
        <span role="status" style={{ fontSize: 12, color: "#027a48" }}>{t("changesSaved")}</span>
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

// ── LOGO (GAP-ADMIN-SETTINGS-05) ─────────────────────────────────────────────
/** base64 of a File without the data: prefix. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * The organisation logo: a real file input (keyboard and screen-reader operable), checked for type and
 * size before anything is sent, uploaded as base64 JSON (the admin-service stores PNG/JPEG only, so no
 * SVG can carry script), with a preview and a confirmed remove.
 */
function LogoField({ initial }: { initial: AdminSettings["logo"] }) {
  const t = useTranslations("adminSettings");
  const id = useId();
  const [present, setPresent] = useState(initial.present);
  const [preview, setPreviewUrl] = useState<string | null>(null);
  // The preview is ONLY ever a blob: URL made here from bytes that passed the PNG/JPEG check, and it is
  // revoked when replaced or on unmount; no value taken from the page or the network reaches <img src>.
  const previewRef = useRef<string | null>(null);
  function setPreview(blob: Blob | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const ok = blob !== null && (LOGO_TYPES as readonly string[]).includes(blob.type);
    const url = ok ? URL.createObjectURL(blob) : null;
    previewRef.current = url;
    setPreviewUrl(url && url.startsWith("blob:") ? url : null);
  }
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | undefined>(undefined);

  // Show the stored logo. A failed preview read is not an error for the form: the upload still works.
  useEffect(() => {
    if (!initial.present) return;
    let cancelled = false;
    fetch("/api/proxy/v1/admin/settings/logo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data?: { contentType?: string; dataBase64?: string } } | null) => {
        const d = body?.data;
        if (cancelled || !d?.contentType || !d.dataBase64 || !(LOGO_TYPES as readonly string[]).includes(d.contentType)) return;
        const bytes = Uint8Array.from(atob(d.dataBase64), (c) => c.charCodeAt(0));
        setPreview(new Blob([bytes], { type: d.contentType }));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [initial.present]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const bad = logoProblem(file);
    if (bad) { setProblem(bad === "type" ? t("logoTypeProblem") : bad === "empty" ? t("logoEmptyProblem") : t("logoSizeProblem", { kb: Math.floor(LOGO_MAX_BYTES / 1000) })); return; }
    setProblem(null);
    setBusy(true);
    try {
      const dataBase64 = await readBase64(file);
      const res = await fetch("/api/proxy/v1/admin/settings/logo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentType: file.type, dataBase64 }),
      });
      if (!res.ok) {
        const human = toHumanError(res.status === 403 ? "forbidden" : "save", { area: "logo" });
        setProblem(`${human.what} ${human.next}`);
        return;
      }
      setPreview(file);
      setPresent(true);
    } catch {
      const human = toHumanError("save", { area: "logo" });
      setProblem(`${human.what} ${human.next}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setRemoveError(undefined);
    try {
      const res = await fetch("/api/proxy/v1/admin/settings/logo", { method: "DELETE" });
      if (!res.ok) {
        const human = toHumanError("save", { area: "logo" });
        setRemoveError(`${human.what} ${human.next}`);
        return;
      }
      setPreview(null);
      setPresent(false);
      setRemoveOpen(false);
    } catch {
      const human = toHumanError("save", { area: "logo" });
      setRemoveError(`${human.what} ${human.next}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <label htmlFor={`${id}-logo`} style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink2)" }}>{t("logo")}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        {preview ? (
          <img src={preview} alt={t("logoAlt")} style={{ maxHeight: 56, maxWidth: 160, objectFit: "contain", border: "1px solid var(--line)", borderRadius: 8, padding: 6, background: "#fff" }} />
        ) : (
          <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{present ? t("logoSaved") : t("logoNone")}</span>
        )}
        <input id={`${id}-logo`} type="file" accept="image/png,image/jpeg" onChange={(e) => void onPick(e)} disabled={busy} aria-describedby={`${id}-logo-hint`} />
        {present && <Button type="button" variant="ghost" size="sm" onClick={() => { setRemoveError(undefined); setRemoveOpen(true); }} disabled={busy}>{t("logoRemove")}</Button>}
      </div>
      <span id={`${id}-logo-hint`} style={{ fontSize: 12, color: "var(--mut)" }}>{t("logoHint", { kb: Math.floor(LOGO_MAX_BYTES / 1000) })}</span>
      {busy && <span role="status" style={{ fontSize: 12, color: "var(--mut)" }}>{t("logoWorking")}</span>}
      {problem && <span role="alert" style={{ fontSize: 12, color: "#b42318" }}>{problem}</span>}
      <ConfirmDialog
        open={removeOpen}
        danger
        title={t("logoRemoveTitle")}
        description={t("logoRemoveBody")}
        confirmLabel={t("logoRemove")}
        busy={busy}
        errorMessage={removeError}
        onConfirm={() => void remove()}
        onCancel={() => { if (!busy) setRemoveOpen(false); }}
      />
    </div>
  );
}

// ── GENERAL TAB ──────────────────────────────────────────────────────────────
function GeneralSection({ settings, onDirtyChange }: { settings: AdminSettings; onDirtyChange: (dirty: boolean) => void }) {
  const t = useTranslations("adminSettings");
  const id = useId();
  const { values, update, dirty, saveState, save, formError, fieldError } = useSectionState<GeneralForm>(
    generalForm(settings),
    "general settings",
    onDirtyChange,
  );

  return (
    <Card>
      <div className="pad" style={{ display: "grid", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{t("generalTitle")}</h3>
          <SaveButton dirty={dirty} saveState={saveState} onSave={() => void save("/api/proxy/v1/admin/settings/general")} errorMessage={formError.message} />
        </div>
        <NotConfiguredNote configured={settings.general.configured} />
        <FieldRow label={t("orgName")} htmlFor={`${id}-orgName`} error={fieldError("orgName")}>
          <input id={`${id}-orgName`} value={values.orgName} onChange={(e) => update({ orgName: e.target.value })} style={inp} />
        </FieldRow>
        <LogoField initial={settings.logo} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <FieldRow label={t("timezone")} htmlFor={`${id}-tz`} error={formError.fieldError("timezone")}>
            <select id={`${id}-tz`} value={values.timezone} onChange={(e) => update({ timezone: e.target.value })} style={inp}>
              <option value="">{t("unchanged")}</option>
              <option value="Asia/Kolkata">{t("tzIst")}</option>
              <option value="UTC">{t("tzUtc")}</option>
            </select>
          </FieldRow>
          <FieldRow label={t("currency")} htmlFor={`${id}-curr`} error={formError.fieldError("currency")}>
            <select id={`${id}-curr`} value={values.currency} onChange={(e) => update({ currency: e.target.value })} style={inp}>
              <option value="">{t("unchanged")}</option>
              <option value="INR">{t("curInr")}</option>
              <option value="USD">{t("curUsd")}</option>
            </select>
          </FieldRow>
          <FieldRow label={t("dateFormat")} htmlFor={`${id}-df`} error={formError.fieldError("dateFormat")}>
            <select id={`${id}-df`} value={values.dateFormat} onChange={(e) => update({ dateFormat: e.target.value })} style={inp}>
              <option value="">{t("unchanged")}</option>
              <option value="dd/MM/yyyy">{t("dfGfr")}</option>
              <option value="yyyy-MM-dd">{t("dfIso")}</option>
            </select>
          </FieldRow>
          <FieldRow label={t("fiscalYear")} htmlFor={`${id}-fy`} error={formError.fieldError("fiscalYearStart")}>
            <select id={`${id}-fy`} value={values.fiscalYearStart} onChange={(e) => update({ fiscalYearStart: e.target.value })} style={inp}>
              <option value="">{t("unchanged")}</option>
              <option value="04">{t("fyApril")}</option>
              <option value="01">{t("fyJanuary")}</option>
            </select>
          </FieldRow>
        </div>
      </div>
    </Card>
  );
}

// ── EMAIL TAB ────────────────────────────────────────────────────────────────
function EmailSection({ settings, onDirtyChange }: { settings: AdminSettings; onDirtyChange: (dirty: boolean) => void }) {
  const t = useTranslations("adminSettings");
  const id = useId();
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "queued" | "not-configured" | "rate-limited" | "fail">("idle");
  const [testRecipient, setTestRecipient] = useState("");
  const [passwordStored, setPasswordStored] = useState(settings.hasSmtpPassword);
  const { values, update, dirty, saveState, save, formError, fieldError } = useSectionState<EmailForm>(
    // smtpPass is write-only: it starts empty and is never sent unless the admin types a new one.
    emailForm(settings),
    "email settings",
    onDirtyChange,
  );

  async function saveEmail() {
    const typedPassword = values.smtpPass !== "";
    await save("/api/proxy/v1/admin/settings/email");
    if (typedPassword) setPasswordStored(true);
  }

  // GAP-ADMIN-SETTINGS-06: the test uses the SAVED settings, sends to the address typed here, and the
  // outcome says what happened (queued / not configured yet / failed), not just "ok".
  async function sendTest() {
    setTestStatus("sending");
    try {
      const res = await fetch("/api/proxy/v1/admin/settings/email/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipient: testRecipient.trim() }),
      });
      setTestStatus(res.ok ? "queued" : res.status === 409 ? "not-configured" : res.status === 429 ? "rate-limited" : "fail");
    } catch {
      setTestStatus("fail");
    }
  }

  return (
    <Card>
      <div className="pad" style={{ display: "grid", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{t("emailTitle")}</h3>
          <SaveButton dirty={dirty} saveState={saveState} onSave={() => void saveEmail()} errorMessage={formError.message} />
        </div>
        <NotConfiguredNote configured={settings.email.configured} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 16 }}>
          <FieldRow label={t("smtpHost")} htmlFor={`${id}-host`} error={fieldError("smtpHost")}>
            <input id={`${id}-host`} value={values.smtpHost} onChange={(e) => update({ smtpHost: e.target.value })} placeholder="smtp.nic.in" style={inp} />
          </FieldRow>
          <FieldRow label={t("port")} htmlFor={`${id}-port`} error={fieldError("smtpPort")}>
            <input id={`${id}-port`} value={values.smtpPort} onChange={(e) => update({ smtpPort: e.target.value })} placeholder="587" type="number" min={1} max={65535} style={inp} />
          </FieldRow>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <FieldRow label={t("username")} htmlFor={`${id}-user`} error={formError.fieldError("smtpUser")}>
            <input id={`${id}-user`} value={values.smtpUser} onChange={(e) => update({ smtpUser: e.target.value })} style={inp} />
          </FieldRow>
          <FieldRow label={t("password")} htmlFor={`${id}-pass`} error={formError.fieldError("smtpPass")}>
            <input id={`${id}-pass`} type="password" value={values.smtpPass} onChange={(e) => update({ smtpPass: e.target.value })} placeholder={passwordStored ? t("passwordSaved") : t("passwordNone")} style={inp} autoComplete="new-password" />
          </FieldRow>
          <FieldRow label={t("fromName")} htmlFor={`${id}-fname`} error={formError.fieldError("fromName")}>
            <input id={`${id}-fname`} value={values.fromName} onChange={(e) => update({ fromName: e.target.value })} style={inp} />
          </FieldRow>
          <FieldRow label={t("fromEmail")} htmlFor={`${id}-femail`} error={formError.fieldError("fromEmail")}>
            <input id={`${id}-femail`} type="email" value={values.fromEmail} onChange={(e) => update({ fromEmail: e.target.value })} style={inp} />
          </FieldRow>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13.5 }}>
          <input type="checkbox" checked={values.useTls} onChange={(e) => update({ useTls: e.target.checked })} style={{ width: 16, height: 16, cursor: "pointer" }} />
          {t("useTls")}
        </label>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
            <FieldRow label={t("testTo")} htmlFor={`${id}-testto`}>
              <input id={`${id}-testto`} type="email" value={testRecipient} onChange={(e) => { setTestRecipient(e.target.value); setTestStatus("idle"); }} placeholder="you@dept.gov.in" style={{ ...inp, width: 280 }} />
            </FieldRow>
            <Button type="button" variant="ghost" size="sm" onClick={() => void sendTest()} loading={testStatus === "sending"} disabled={!/^\S+@\S+\.\S+$/.test(testRecipient.trim()) || testStatus === "sending"}>
              {testStatus === "sending" ? t("testSending") : t("testSend")}
            </Button>
          </div>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{t("testExplain")}</span>
          {testStatus === "queued" && <span role="status" style={{ fontSize: 12, color: "#027a48" }}>{t("testQueued", { recipient: testRecipient.trim() })}</span>}
          {testStatus === "not-configured" && <span role="alert" style={{ fontSize: 12, color: "#b42318" }}>{t("testNotConfigured")}</span>}
          {testStatus === "rate-limited" && <span role="alert" style={{ fontSize: 12, color: "#b42318" }}>{t("testRateLimited")}</span>}
          {testStatus === "fail" && <span role="alert" style={{ fontSize: 12, color: "#b42318" }}>{t("testFailed")}</span>}
        </div>
      </div>
    </Card>
  );
}

// ── SECURITY TAB ─────────────────────────────────────────────────────────────
function SecuritySection({ settings, onDirtyChange }: { settings: AdminSettings; onDirtyChange: (dirty: boolean) => void }) {
  const t = useTranslations("adminSettings");
  const id = useId();
  const [mfaConfirm, setMfaConfirm] = useState(false);
  const [pendingBody, setPendingBody] = useState<Record<string, unknown> | null>(null);
  const { values, update, dirty, saveState, save, formError, changedValues, setLocalErrors, fieldError } = useSectionState<SecurityForm>(
    securityForm(settings),
    "security settings",
    onDirtyChange,
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
          <h3 style={{ margin: 0 }}>{t("securityTitle")}</h3>
          <SaveButton dirty={dirty} saveState={saveState} onSave={requestSave} errorMessage={formError.message} />
        </div>
        <NotConfiguredNote configured={settings.security.configured} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <FieldRow label={t("sessionTimeout", { min: SESSION_TIMEOUT_MIN.min, max: SESSION_TIMEOUT_MIN.max })} htmlFor={`${id}-sto`} error={fieldError("sessionTimeoutMin")}>
            <input id={`${id}-sto`} type="number" inputMode="numeric" min={SESSION_TIMEOUT_MIN.min} max={SESSION_TIMEOUT_MIN.max} value={values.sessionTimeoutMin} onChange={(e) => update({ sessionTimeoutMin: e.target.value })} style={inp} />
          </FieldRow>
          <FieldRow label={t("maxAttempts", { min: MAX_LOGIN_ATTEMPTS.min, max: MAX_LOGIN_ATTEMPTS.max })} htmlFor={`${id}-mla`} error={fieldError("maxLoginAttempts")}>
            <input id={`${id}-mla`} type="number" inputMode="numeric" min={MAX_LOGIN_ATTEMPTS.min} max={MAX_LOGIN_ATTEMPTS.max} value={values.maxLoginAttempts} onChange={(e) => update({ maxLoginAttempts: e.target.value })} style={inp} />
          </FieldRow>
          <FieldRow label={t("minPassword", { min: PASSWORD_MIN_LEN.min, max: PASSWORD_MIN_LEN.max })} htmlFor={`${id}-pwlen`} error={fieldError("passwordMinLen")}>
            <input id={`${id}-pwlen`} type="number" inputMode="numeric" min={PASSWORD_MIN_LEN.min} max={PASSWORD_MIN_LEN.max} value={values.passwordMinLen} onChange={(e) => update({ passwordMinLen: e.target.value })} style={inp} />
          </FieldRow>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label htmlFor={`${id}-mfa`} style={{ fontSize: 13.5, fontWeight: 550, cursor: "pointer" }}>
            {t("mfaRequire")}
          </label>
          <input id={`${id}-mfa`} type="checkbox" role="switch" checked={values.mfaRequired} onChange={(e) => handleMfaToggle(e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
        </div>
        {mfaConfirm && (
          <div role="alertdialog" aria-modal="true" style={{ background: "var(--warn-bg, #fffbeb)", border: "1px solid var(--warn-bd, #fcd34d)", borderRadius: 10, padding: "14px 16px", display: "grid", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>{t("mfaDisableTitle")}</p>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>{t("mfaDisableBody")}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <Button type="button" variant="danger" size="sm" onClick={() => { update({ mfaRequired: false }); setMfaConfirm(false); }}>{t("mfaDisableYes")}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setMfaConfirm(false)}>{t("cancel")}</Button>
            </div>
          </div>
        )}
        <FieldRow label={t("ipLabel")} htmlFor={`${id}-ip`} error={fieldError("ipWhitelist")}>
          <textarea id={`${id}-ip`} rows={4} value={values.ipWhitelist} onChange={(e) => update({ ipWhitelist: e.target.value })} placeholder={"10.0.0.0/8\n192.168.1.0/24"} style={{ ...inp, resize: "vertical", fontFamily: "monospace", fontSize: 13 }} aria-describedby={`${id}-ip-hint`} />
          <p id={`${id}-ip-hint`} style={{ margin: "4px 0 0", fontSize: 11.5, color: "var(--mut)" }}>{t("ipHint")}</p>
        </FieldRow>
      </div>
      <ConfirmDialog
        open={pendingBody !== null}
        danger={lockoutRisk}
        title={t("saveSecurityTitle")}
        description={
          <div>
            <p style={{ margin: "0 0 8px" }}>{t("saveSecurityBody")}</p>
            {lockoutRisk && (
              <p style={{ margin: 0 }}>
                <strong>{t("lockoutWarnStrong")}</strong> {t("lockoutWarnRest")}
              </p>
            )}
          </div>
        }
        confirmLabel={t("saveSecurityConfirm")}
        busy={saveState === "saving"}
        onConfirm={() => { const body = pendingBody; setPendingBody(null); if (body) void save("/api/proxy/v1/admin/settings/security", body); }}
        onCancel={() => setPendingBody(null)}
      />
    </Card>
  );
}

// ── INTEGRATIONS TAB ─────────────────────────────────────────────────────────
function IntegrationsSection({ settings, onDirtyChange }: { settings: AdminSettings; onDirtyChange: (dirty: boolean) => void }) {
  const t = useTranslations("adminSettings");
  const id = useId();
  const { values, update, dirty, saveState, save, formError, fieldError } = useSectionState<IntegrationsForm>(
    integrationsForm(settings),
    "integrations settings",
    onDirtyChange,
  );

  return (
    <Card>
      <div className="pad" style={{ display: "grid", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{t("integrationsTitle")}</h3>
          <SaveButton dirty={dirty} saveState={saveState} onSave={() => void save("/api/proxy/v1/admin/settings/integrations")} errorMessage={formError.message} />
        </div>
        <NotConfiguredNote configured={settings.integrations.configured} />
        <FieldRow label={t("pfmsUrl")} htmlFor={`${id}-pfms`} error={fieldError("pfmsUrl")}>
          <input id={`${id}-pfms`} type="url" value={values.pfmsUrl} onChange={(e) => update({ pfmsUrl: e.target.value })} style={inp} />
        </FieldRow>
        <FieldRow label={t("nicUrl")} htmlFor={`${id}-nic`} error={formError.fieldError("nicGatewayUrl")}>
          <input id={`${id}-nic`} type="url" value={values.nicGatewayUrl} onChange={(e) => update({ nicGatewayUrl: e.target.value })} style={inp} />
        </FieldRow>
        <fieldset style={{ border: "none", margin: 0, padding: 0, display: "grid", gap: 14 }}>
          <legend style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink2)", marginBottom: 8 }}>{t("thirdParty")}</legend>
          {([
            { key: "digiLockerEnabled" as const, label: t("digiLocker"), desc: t("digiLockerDesc") },
            { key: "umangEnabled" as const, label: t("umang"), desc: t("umangDesc") },
          ] as const).map(({ key, label, desc }) => (
            <label key={key} style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
              <input type="checkbox" id={`${id}-${key}`} role="switch" checked={values[key]} onChange={(e) => update({ [key]: e.target.checked } as Record<string, boolean>)} style={{ width: 16, height: 16, cursor: "pointer", marginTop: 2, flexShrink: 0 }} />
              <span>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 550 }}>{label}</span>
                <span style={{ display: "block", fontSize: 12, color: "var(--mut)" }}>{desc}</span>
              </span>
              {values[key] && <span className="pill good" style={{ fontSize: 11, flexShrink: 0 }}>{t("active")}</span>}
            </label>
          ))}
        </fieldset>
      </div>
    </Card>
  );
}

// ── TENANT CONFIG TAB (platform staff only) ──────────────────────────────────
function TenantConfigSection({ tenant }: { tenant: TenantConfigData }) {
  const t = useTranslations("adminSettings");
  // GAP-ADMIN-SETTINGS-02: values come from the real tenant record
  // (GET /v1/admin/tenants/:id), never from constants. Realm / DB schema /
  // storage figures are not exposed by any endpoint, so they are not shown.
  return (
    <Card>
      <div className="pad" style={{ display: "grid", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{t("tenantTitle")}</h3>
          <span className="pill info" style={{ fontSize: 11 }}>{t("tenantReadOnly")}</span>
        </div>
        {tenant.state === "ready" ? (
          <>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--mut)" }}>{t("tenantManaged")}</p>
            {([
              { label: t("tenantName"), value: tenant.name },
              { label: t("tenantDomain"), value: tenant.domain },
              { label: t("tenantEdition"), value: tenant.edition },
              { label: t("tenantStatus"), value: tenant.status },
              { label: t("tenantRegion"), value: tenant.region },
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
              ? t("tenantForbidden")
              : t("tenantUnavailable")}
          </p>
        )}
      </div>
    </Card>
  );
}

function SettingsLoadError({ forbidden }: { forbidden: boolean }) {
  const human = toHumanError(forbidden ? "forbidden" : "load", { area: "system settings" });
  return (
    <Card>
      <div className="pad">
        <RefreshErrorState error={{ ...human, actions: forbidden ? ["back"] : ["retry", "back"] }} backHref="/admin" />
      </div>
    </Card>
  );
}

// ── PAGE ─────────────────────────────────────────────────────────────────────
export function SystemSettingsClient({ tenant, settings }: { tenant: TenantConfigData; settings: SettingsLoad }) {
  const t = useTranslations("adminSettings");
  const TAB_KEYS: Record<Tab, string> = { General: "tabGeneral", Email: "tabEmail", Security: "tabSecurity", Integrations: "tabIntegrations", "Tenant Config": "tabTenantConfig" };
  const tabLabel = (tab: Tab) => t(TAB_KEYS[tab]);
  const baseId = useId();
  const [activeTab, setActiveTab] = useState<Tab>("General");
  // GAP-ADMIN-SETTINGS-04: every section stays mounted (hidden, not unmounted) so edits survive a
  // tab switch; each section reports whether it holds unsaved edits.
  const [dirtyTabs, setDirtyTabs] = useState<ReadonlySet<Tab>>(new Set());
  const tabRefs = useRef<Array<HTMLSpanElement | null>>([]);
  // The Tenant Config tab exists only for platform staff (the server page decides).
  const TABS = ALL_TABS.filter((t) => t !== "Tenant Config" || tenant.state !== "hidden");

  const setDirty = (tab: Tab) => (dirty: boolean) =>
    setDirtyTabs((prev) => {
      if (prev.has(tab) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(tab); else next.delete(tab);
      return next;
    });
  const dirtyGeneral = useRef(setDirty("General")).current;
  const dirtyEmail = useRef(setDirty("Email")).current;
  const dirtySecurity = useRef(setDirty("Security")).current;
  const dirtyIntegrations = useRef(setDirty("Integrations")).current;

  const anyDirty = dirtyTabs.size > 0;
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  const tabId = (t: Tab) => `${baseId}-tab-${t.replace(/\s+/g, "-")}`;
  const panelId = (t: Tab) => `${baseId}-panel-${t.replace(/\s+/g, "-")}`;

  // WAI-ARIA tabs: roving tabindex + Arrow/Home/End, automatic activation.
  function onTabKeyDown(e: KeyboardEvent<HTMLSpanElement>, index: number) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveTab(TABS[index]); return; }
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    setActiveTab(TABS[next]);
    tabRefs.current[next]?.focus();
  }

  const names = TABS.map((tab) => tabLabel(tab));
  const subtitle = t("subtitle", { list: names.slice(0, -1).join(", "), last: names[names.length - 1]! });

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={subtitle} back="/admin" />
      <div className="tabs" role="tablist" aria-label={t("tabsLabel")} style={{ marginBottom: 20 }}>
        {TABS.map((tab, index) => {
          const selected = activeTab === tab;
          return (
            <span
              key={tab}
              id={tabId(tab)}
              ref={(el) => { tabRefs.current[index] = el; }}
              className={selected ? "on" : undefined}
              role="tab"
              aria-selected={selected}
              aria-controls={panelId(tab)}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(e) => onTabKeyDown(e, index)}
            >
              {tabLabel(tab)}
              {dirtyTabs.has(tab) && (
                <>
                  <span aria-hidden="true" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", marginInlineStart: 6 }} />
                  <span className="sr-only"> ({t("unsavedChanges")})</span>
                </>
              )}
            </span>
          );
        })}
      </div>
      {/* GAP-ADMIN-SETTINGS-01: if the stored settings could not be read there is no form and no Save,
          so nothing can overwrite values this screen never saw. */}
      <div role="tabpanel" id={panelId("General")} aria-labelledby={tabId("General")} hidden={activeTab !== "General"}>{settings.state === "ready" ? <GeneralSection settings={settings.settings} onDirtyChange={dirtyGeneral} /> : <SettingsLoadError forbidden={settings.forbidden} />}</div>
      <div role="tabpanel" id={panelId("Email")} aria-labelledby={tabId("Email")} hidden={activeTab !== "Email"}>{settings.state === "ready" ? <EmailSection settings={settings.settings} onDirtyChange={dirtyEmail} /> : <SettingsLoadError forbidden={settings.forbidden} />}</div>
      <div role="tabpanel" id={panelId("Security")} aria-labelledby={tabId("Security")} hidden={activeTab !== "Security"}>{settings.state === "ready" ? <SecuritySection settings={settings.settings} onDirtyChange={dirtySecurity} /> : <SettingsLoadError forbidden={settings.forbidden} />}</div>
      <div role="tabpanel" id={panelId("Integrations")} aria-labelledby={tabId("Integrations")} hidden={activeTab !== "Integrations"}>{settings.state === "ready" ? <IntegrationsSection settings={settings.settings} onDirtyChange={dirtyIntegrations} /> : <SettingsLoadError forbidden={settings.forbidden} />}</div>
      {tenant.state !== "hidden" && (
        <div role="tabpanel" id={panelId("Tenant Config")} aria-labelledby={tabId("Tenant Config")} hidden={activeTab !== "Tenant Config"}><TenantConfigSection tenant={tenant} /></div>
      )}
    </div>
  );
}
