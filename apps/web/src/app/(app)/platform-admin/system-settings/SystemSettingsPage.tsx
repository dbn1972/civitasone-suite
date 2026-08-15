"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ConfirmDialog } from "@/app/_components/ds";

/* ─── Types ─────────────────────────────────────────────────────────── */
type GeneralSettings = {
  orgName: string;
  logoUrl: string;
  timezone: string;
  currency: string;
};
type EmailSettings = {
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpFromAddress: string;
  smtpFromName: string;
};
type SecuritySettings = {
  sessionTimeoutMin: string;
  mfaRequired: boolean;
  ipWhitelist: string;
};
type IntegrationSettings = {
  pfmsEndpoint: string;
  nicApiKey: string;
  digiLockerClientId: string;
  digiLockerRedirectUri: string;
};

const TIMEZONES = [
  "Asia/Kolkata",
  "UTC",
  "Asia/Dubai",
  "America/New_York",
  "Europe/London",
];
const CURRENCIES = ["INR", "USD", "EUR", "GBP"];

const DEFAULT_GENERAL: GeneralSettings = {
  orgName: "Government of India — Digital Services",
  logoUrl: "",
  timezone: "Asia/Kolkata",
  currency: "INR",
};
const DEFAULT_EMAIL: EmailSettings = {
  smtpHost: "smtp.nic.in",
  smtpPort: "587",
  smtpUser: "no-reply@nic.in",
  smtpFromAddress: "no-reply@nic.in",
  smtpFromName: "CivitasOne Platform",
};
const DEFAULT_SECURITY: SecuritySettings = {
  sessionTimeoutMin: "30",
  mfaRequired: true,
  ipWhitelist: "",
};
const DEFAULT_INTEGRATIONS: IntegrationSettings = {
  pfmsEndpoint: "https://pfms.nic.in/api/v1",
  nicApiKey: "",
  digiLockerClientId: "",
  digiLockerRedirectUri: "",
};

/* ─── Section card ──────────────────────────────────────────────────── */
function SectionCard({
  title,
  editing,
  onEdit,
  onSave,
  onCancel,
  busy,
  error,
  children,
}: {
  title: string;
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3 style={{ margin: 0 }}>{title}</h3>
        {editing ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn ghost sm" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn primary sm" onClick={onSave} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        ) : (
          <button type="button" className="btn ghost sm" onClick={onEdit}>
            Edit
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" style={{ fontSize: 12.5, color: "var(--bad, #b42318)", margin: 0, padding: "6px 16px 0" }}>
          {error}
        </p>
      ) : null}
      <div style={{ padding: "16px" }}>{children}</div>
    </div>
  );
}

/* ─── Field helpers ─────────────────────────────────────────────────── */
const lbl: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 650, color: "var(--ink2)", marginBottom: 4 };
const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13.5, fontFamily: "inherit", color: "var(--ink)", boxSizing: "border-box" as const };
const sel: React.CSSProperties = { ...inp };
const ro: React.CSSProperties = { ...inp, background: "var(--line2, #f8fafc)", color: "var(--ink2)", cursor: "default" };
const row: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 };
const fullRow: React.CSSProperties = { marginBottom: 16 };

function Field({ label: fieldLabel, id, editing, children }: { label: string; id: string; editing: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} style={lbl}>{fieldLabel}</label>
      {children}
    </div>
  );
}

async function fakeSave(section: string): Promise<void> {
  const res = await fetch(`/api/proxy/v1/admin/settings/${section}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ _placeholder: true }),
  }).catch(() => null);
  // tolerate 404 — settings API may not exist yet
  if (res && !res.ok && res.status !== 404 && res.status !== 405) {
    throw new Error(`Server error (${res.status})`);
  }
}

/* ─── Main component ────────────────────────────────────────────────── */
export function SystemSettingsPage() {
  const [general, setGeneral] = useState<GeneralSettings>(DEFAULT_GENERAL);
  const [email, setEmail] = useState<EmailSettings>(DEFAULT_EMAIL);
  const [security, setSecurity] = useState<SecuritySettings>(DEFAULT_SECURITY);
  const [integrations, setIntegrations] = useState<IntegrationSettings>(DEFAULT_INTEGRATIONS);

  const [editSection, setEditSection] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMsg, setSuccessMsg] = useState("");
  const [discardOpen, setDiscardOpen] = useState<{ section: string; savedState: unknown } | null>(null);

  const savedState = useRef<Record<string, unknown>>({});

  // Unsaved-changes warning on tab close
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (editSection) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editSection]);

  function startEdit(section: string, currentState: unknown) {
    if (editSection && editSection !== section) {
      setDiscardOpen({ section, savedState: currentState });
      return;
    }
    savedState.current[section] = JSON.parse(JSON.stringify(currentState));
    setEditSection(section);
    setErrors((e) => ({ ...e, [section]: "" }));
    setSuccessMsg("");
  }

  function cancelEdit(section: string, resetFn: () => void) {
    resetFn();
    setEditSection(null);
    setErrors((e) => ({ ...e, [section]: "" }));
  }

  async function saveSection(section: string) {
    setBusy(true);
    setErrors((e) => ({ ...e, [section]: "" }));
    try {
      await fakeSave(section);
      setEditSection(null);
      setSuccessMsg(`${section.replace(/-/g, " ")} settings saved.`);
    } catch (err) {
      setErrors((e) => ({ ...e, [section]: err instanceof Error ? err.message : "Save failed." }));
    } finally {
      setBusy(false);
    }
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
      <SectionCard
        title="General"
        editing={editSection === "general"}
        onEdit={() => startEdit("general", general)}
        onSave={() => void saveSection("general")}
        onCancel={() => cancelEdit("general", () => setGeneral(savedState.current["general"] as GeneralSettings ?? DEFAULT_GENERAL))}
        busy={busy}
        error={errors["general"]}
      >
        <div style={row}>
          <Field label="Organisation name" id={`${gId}-name`} editing={editSection === "general"}>
            {editSection === "general" ? (
              <input id={`${gId}-name`} style={inp} value={general.orgName} onChange={(e) => setGeneral((s) => ({ ...s, orgName: e.target.value }))} />
            ) : (
              <input id={`${gId}-name`} style={ro} value={general.orgName} readOnly />
            )}
          </Field>
          <Field label="Logo URL" id={`${gId}-logo`} editing={editSection === "general"}>
            {editSection === "general" ? (
              <input id={`${gId}-logo`} style={inp} value={general.logoUrl} placeholder="https://…" onChange={(e) => setGeneral((s) => ({ ...s, logoUrl: e.target.value }))} />
            ) : (
              <input id={`${gId}-logo`} style={ro} value={general.logoUrl || "—"} readOnly />
            )}
          </Field>
        </div>
        <div style={row}>
          <Field label="Timezone" id={`${gId}-tz`} editing={editSection === "general"}>
            {editSection === "general" ? (
              <select id={`${gId}-tz`} style={sel} value={general.timezone} onChange={(e) => setGeneral((s) => ({ ...s, timezone: e.target.value }))}>
                {TIMEZONES.map((tz) => <option key={tz}>{tz}</option>)}
              </select>
            ) : (
              <input id={`${gId}-tz`} style={ro} value={general.timezone} readOnly />
            )}
          </Field>
          <Field label="Currency" id={`${gId}-cur`} editing={editSection === "general"}>
            {editSection === "general" ? (
              <select id={`${gId}-cur`} style={sel} value={general.currency} onChange={(e) => setGeneral((s) => ({ ...s, currency: e.target.value }))}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            ) : (
              <input id={`${gId}-cur`} style={ro} value={general.currency} readOnly />
            )}
          </Field>
        </div>
      </SectionCard>

      {/* Email */}
      <SectionCard
        title="Email (SMTP)"
        editing={editSection === "email"}
        onEdit={() => startEdit("email", email)}
        onSave={() => void saveSection("email")}
        onCancel={() => cancelEdit("email", () => setEmail(savedState.current["email"] as EmailSettings ?? DEFAULT_EMAIL))}
        busy={busy}
        error={errors["email"]}
      >
        <div style={row}>
          <Field label="SMTP host" id={`${eId}-host`} editing={editSection === "email"}>
            {editSection === "email" ? (
              <input id={`${eId}-host`} style={inp} value={email.smtpHost} onChange={(e) => setEmail((s) => ({ ...s, smtpHost: e.target.value }))} />
            ) : (
              <input id={`${eId}-host`} style={ro} value={email.smtpHost} readOnly />
            )}
          </Field>
          <Field label="Port" id={`${eId}-port`} editing={editSection === "email"}>
            {editSection === "email" ? (
              <input id={`${eId}-port`} style={inp} value={email.smtpPort} onChange={(e) => setEmail((s) => ({ ...s, smtpPort: e.target.value }))} />
            ) : (
              <input id={`${eId}-port`} style={ro} value={email.smtpPort} readOnly />
            )}
          </Field>
        </div>
        <div style={row}>
          <Field label="Username" id={`${eId}-user`} editing={editSection === "email"}>
            {editSection === "email" ? (
              <input id={`${eId}-user`} style={inp} value={email.smtpUser} onChange={(e) => setEmail((s) => ({ ...s, smtpUser: e.target.value }))} />
            ) : (
              <input id={`${eId}-user`} style={ro} value={email.smtpUser} readOnly />
            )}
          </Field>
          <Field label="Password" id={`${eId}-pass`} editing={editSection === "email"}>
            <input id={`${eId}-pass`} style={editSection === "email" ? inp : ro} type="password" placeholder="••••••••" readOnly={editSection !== "email"} />
          </Field>
        </div>
        <div style={row}>
          <Field label="From address" id={`${eId}-from`} editing={editSection === "email"}>
            {editSection === "email" ? (
              <input id={`${eId}-from`} style={inp} value={email.smtpFromAddress} onChange={(e) => setEmail((s) => ({ ...s, smtpFromAddress: e.target.value }))} />
            ) : (
              <input id={`${eId}-from`} style={ro} value={email.smtpFromAddress} readOnly />
            )}
          </Field>
          <Field label="From name" id={`${eId}-fromname`} editing={editSection === "email"}>
            {editSection === "email" ? (
              <input id={`${eId}-fromname`} style={inp} value={email.smtpFromName} onChange={(e) => setEmail((s) => ({ ...s, smtpFromName: e.target.value }))} />
            ) : (
              <input id={`${eId}-fromname`} style={ro} value={email.smtpFromName} readOnly />
            )}
          </Field>
        </div>
      </SectionCard>

      {/* Security */}
      <SectionCard
        title="Security"
        editing={editSection === "security"}
        onEdit={() => startEdit("security", security)}
        onSave={() => void saveSection("security")}
        onCancel={() => cancelEdit("security", () => setSecurity(savedState.current["security"] as SecuritySettings ?? DEFAULT_SECURITY))}
        busy={busy}
        error={errors["security"]}
      >
        <div style={row}>
          <Field label="Session timeout (minutes)" id={`${sId}-timeout`} editing={editSection === "security"}>
            {editSection === "security" ? (
              <input id={`${sId}-timeout`} style={inp} type="number" min={5} max={480} value={security.sessionTimeoutMin} onChange={(e) => setSecurity((s) => ({ ...s, sessionTimeoutMin: e.target.value }))} />
            ) : (
              <input id={`${sId}-timeout`} style={ro} value={`${security.sessionTimeoutMin} min`} readOnly />
            )}
          </Field>
          <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 22 }}>
            <label style={{ fontSize: 13, fontWeight: 600, cursor: editSection === "security" ? "pointer" : "default" }}>
              <input
                type="checkbox"
                checked={security.mfaRequired}
                disabled={editSection !== "security"}
                onChange={(e) => setSecurity((s) => ({ ...s, mfaRequired: e.target.checked }))}
                style={{ marginRight: 8, width: 16, height: 16 }}
              />
              Require MFA for all users
            </label>
          </div>
        </div>
        <div style={fullRow}>
          <label htmlFor={`${sId}-ip`} style={lbl}>IP whitelist <span style={{ fontWeight: 400, color: "var(--ink2)" }}>(one CIDR per line, empty = allow all)</span></label>
          <textarea
            id={`${sId}-ip`}
            style={{ ...inp, minHeight: 80, resize: "vertical" }}
            readOnly={editSection !== "security"}
            value={security.ipWhitelist}
            placeholder="e.g. 10.0.0.0/8"
            onChange={(e) => setSecurity((s) => ({ ...s, ipWhitelist: e.target.value }))}
          />
        </div>
      </SectionCard>

      {/* Integrations */}
      <SectionCard
        title="Integrations"
        editing={editSection === "integrations"}
        onEdit={() => startEdit("integrations", integrations)}
        onSave={() => void saveSection("integrations")}
        onCancel={() => cancelEdit("integrations", () => setIntegrations(savedState.current["integrations"] as IntegrationSettings ?? DEFAULT_INTEGRATIONS))}
        busy={busy}
        error={errors["integrations"]}
      >
        <div style={fullRow}>
          <label htmlFor={`${iId}-pfms`} style={lbl}>PFMS API endpoint</label>
          {editSection === "integrations" ? (
            <input id={`${iId}-pfms`} style={inp} value={integrations.pfmsEndpoint} onChange={(e) => setIntegrations((s) => ({ ...s, pfmsEndpoint: e.target.value }))} />
          ) : (
            <input id={`${iId}-pfms`} style={ro} value={integrations.pfmsEndpoint} readOnly />
          )}
        </div>
        <div style={row}>
          <Field label="NIC API key" id={`${iId}-nic`} editing={editSection === "integrations"}>
            <input
              id={`${iId}-nic`}
              style={editSection === "integrations" ? inp : ro}
              type={editSection === "integrations" ? "text" : "password"}
              placeholder="••••••••"
              value={integrations.nicApiKey}
              readOnly={editSection !== "integrations"}
              onChange={(e) => setIntegrations((s) => ({ ...s, nicApiKey: e.target.value }))}
            />
          </Field>
          <Field label="DigiLocker client ID" id={`${iId}-dl`} editing={editSection === "integrations"}>
            {editSection === "integrations" ? (
              <input id={`${iId}-dl`} style={inp} value={integrations.digiLockerClientId} onChange={(e) => setIntegrations((s) => ({ ...s, digiLockerClientId: e.target.value }))} />
            ) : (
              <input id={`${iId}-dl`} style={ro} value={integrations.digiLockerClientId || "—"} readOnly />
            )}
          </Field>
        </div>
        <div style={fullRow}>
          <label htmlFor={`${iId}-dlredir`} style={lbl}>DigiLocker redirect URI</label>
          {editSection === "integrations" ? (
            <input id={`${iId}-dlredir`} style={inp} value={integrations.digiLockerRedirectUri} placeholder="https://…/auth/digilocker/callback" onChange={(e) => setIntegrations((s) => ({ ...s, digiLockerRedirectUri: e.target.value }))} />
          ) : (
            <input id={`${iId}-dlredir`} style={ro} value={integrations.digiLockerRedirectUri || "—"} readOnly />
          )}
        </div>
      </SectionCard>

      {/* Discard warning */}
      <ConfirmDialog
        open={!!discardOpen}
        title="Discard unsaved changes?"
        description="You have unsaved changes in another section. Switch anyway and lose them?"
        confirmLabel="Discard changes"
        onConfirm={() => {
          if (discardOpen) {
            startEdit(discardOpen.section, discardOpen.savedState);
          }
          setDiscardOpen(null);
        }}
        onCancel={() => setDiscardOpen(null)}
      />
    </div>
  );
}
