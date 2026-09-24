"use client";

import { useState } from "react";
import { Button, PageHeader } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

const inputStyle = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 } as const;
const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 4 } as const;
const fieldErrorStyle = { display: "block", fontSize: 12, color: "#b42318", marginTop: 4 } as const;

export default function AdminConfigPage() {
  const [form, setForm] = useState({
    platformName: "CivitasOne",
    supportEmail: "support@civitasone.in",
    defaultLocale: "en-IN",
    maxLoginAttempts: 5,
    sessionTimeoutMin: 30,
    maintenanceMessage: "",
    allowSelfRegistration: false,
    enforceStrongPassword: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const formError = useFormError("platform configuration");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    formError.clear();
    try {
      const res = await fetch("/api/v1/admin/platform-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setSuccess("Platform configuration saved successfully.");
      setTimeout(() => setSuccess(null), 5000);
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Platform Configuration"
        subtitle="Core platform settings — name, branding, security policies and session controls."
        back="/admin"
      />

      {error && (
        <div
          role="alert"
          aria-live="polite"
          style={{ background: "#fef2f2", color: "#b42318", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          aria-live="polite"
          style={{ background: "#ecfdf5", color: "#065f46", border: "1px solid #a7f3d0", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}
        >
          {success}
        </div>
      )}

      <form onSubmit={handleSave}>
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-h"><h3>General</h3></div>
          <div style={{ padding: 20, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <div>
              <label htmlFor="config-platform-name" style={labelStyle}>
                Platform Name *
              </label>
              <input
                id="config-platform-name"
                type="text"
                value={form.platformName}
                onChange={(e) => setForm({ ...form, platformName: e.target.value })}
                placeholder="e.g. CivitasOne"
                style={inputStyle}
                required
                aria-required="true"
              />
              {formError.fieldError("platformName") && (
                <span role="alert" style={fieldErrorStyle}>{formError.fieldError("platformName")}</span>
              )}
            </div>

            <div>
              <label htmlFor="config-support-email" style={labelStyle}>
                Support Email *
              </label>
              <input
                id="config-support-email"
                type="email"
                value={form.supportEmail}
                onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
                placeholder="support@example.gov.in"
                style={inputStyle}
                required
                aria-required="true"
              />
              {formError.fieldError("supportEmail") && (
                <span role="alert" style={fieldErrorStyle}>{formError.fieldError("supportEmail")}</span>
              )}
            </div>

            <div>
              <label htmlFor="config-locale" style={labelStyle}>
                Default Locale *
              </label>
              <select
                id="config-locale"
                value={form.defaultLocale}
                onChange={(e) => setForm({ ...form, defaultLocale: e.target.value })}
                style={inputStyle}
                required
                aria-required="true"
              >
                <option value="en-IN">English (India)</option>
                <option value="hi-IN">Hindi</option>
                <option value="ta-IN">Tamil</option>
                <option value="te-IN">Telugu</option>
                <option value="mr-IN">Marathi</option>
                <option value="bn-IN">Bengali</option>
              </select>
              {formError.fieldError("defaultLocale") && (
                <span role="alert" style={fieldErrorStyle}>{formError.fieldError("defaultLocale")}</span>
              )}
            </div>

            <div>
              <label htmlFor="config-maintenance-message" style={labelStyle}>
                Maintenance Message
              </label>
              <textarea
                id="config-maintenance-message"
                value={form.maintenanceMessage}
                onChange={(e) => setForm({ ...form, maintenanceMessage: e.target.value })}
                placeholder="Shown to users during scheduled maintenance…"
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-h"><h3>Security</h3></div>
          <div style={{ padding: 20, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <div>
              <label htmlFor="config-max-login-attempts" style={labelStyle}>
                Max Login Attempts *
              </label>
              <input
                id="config-max-login-attempts"
                type="number"
                min={1}
                max={20}
                value={form.maxLoginAttempts}
                onChange={(e) => setForm({ ...form, maxLoginAttempts: Number(e.target.value) })}
                style={inputStyle}
                required
                aria-required="true"
              />
              {formError.fieldError("maxLoginAttempts") && (
                <span role="alert" style={fieldErrorStyle}>{formError.fieldError("maxLoginAttempts")}</span>
              )}
            </div>

            <div>
              <label htmlFor="config-session-timeout" style={labelStyle}>
                Session Timeout (minutes) *
              </label>
              <input
                id="config-session-timeout"
                type="number"
                min={5}
                max={1440}
                value={form.sessionTimeoutMin}
                onChange={(e) => setForm({ ...form, sessionTimeoutMin: Number(e.target.value) })}
                style={inputStyle}
                required
                aria-required="true"
              />
              {formError.fieldError("sessionTimeoutMin") && (
                <span role="alert" style={fieldErrorStyle}>{formError.fieldError("sessionTimeoutMin")}</span>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 20 }}>
              <input
                id="config-self-registration"
                type="checkbox"
                checked={form.allowSelfRegistration}
                onChange={(e) => setForm({ ...form, allowSelfRegistration: e.target.checked })}
                style={{ width: 18, height: 18, cursor: "pointer" }}
              />
              <label htmlFor="config-self-registration" style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>
                Allow self-registration
              </label>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 20 }}>
              <input
                id="config-strong-password"
                type="checkbox"
                checked={form.enforceStrongPassword}
                onChange={(e) => setForm({ ...form, enforceStrongPassword: e.target.checked })}
                style={{ width: 18, height: 18, cursor: "pointer" }}
              />
              <label htmlFor="config-strong-password" style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>
                Enforce strong passwords
              </label>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 32 }}>
          <Button type="submit" disabled={saving} loading={saving}>
            {saving ? "Saving…" : "Save Configuration"}
          </Button>
        </div>
      </form>
    </div>
  );
}
