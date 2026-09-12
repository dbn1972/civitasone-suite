"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function RegisterRTIButton() {
  const t = useTranslations("citizenRti");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ subject: "", description: "", cpioRef: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!UUID_RE.test(form.cpioRef.trim())) {
      setError("CPIO reference must be a valid identifier (UUID).");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/citizen/rti", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: form.subject, description: form.description, cpioRef: form.cpioRef.trim() }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Could not register the RTI application.");
      setMessage("RTI application submitted. It will appear once processed.");
      setOpen(false);
      setForm({ subject: "", description: "", cpioRef: "" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not register the RTI application.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn primary" style={{ minHeight: 44 }} onClick={() => setOpen((o) => !o)}>
        {t("registerButton")}
      </button>
      {open && (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={submit} className="pad" style={{ maxWidth: 560 }}>
            <h4 style={{ marginTop: 0 }}>{t("registerFormTitle")}</h4>
            <label htmlFor="new-rti-subject" style={labelStyle}>{t("subjectLabel")}</label>
            <input id="new-rti-subject" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder={t("subjectPlaceholder")} style={inputStyle} />
            <label htmlFor="new-rti-description" style={labelStyle}>{t("infoSoughtLabel")}</label>
            <textarea id="new-rti-description" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("infoSoughtPlaceholder")} rows={4} style={{ ...inputStyle, minHeight: 100 }} />
            <label htmlFor="new-rti-cpio" style={labelStyle}>{t("cpioLabel")}</label>
            <input id="new-rti-cpio" required value={form.cpioRef} onChange={(e) => setForm({ ...form, cpioRef: e.target.value })} placeholder={t("cpioPlaceholder")} style={inputStyle} />
            <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>{busy ? t("submitting") : t("submitApplication")}</button>
            <button type="button" className="btn ghost" style={{ marginLeft: 8, minHeight: 44 }} onClick={() => setOpen(false)}>{t("cancel")}</button>
          </form>
        </div>
      )}
      {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", marginTop: 8 }}>{message}</p> : null}
      {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 8 }}>{error}</p> : null}
    </>
  );
}
