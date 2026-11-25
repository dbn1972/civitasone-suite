"use client";

/**
 * Host-initiated visit request (pre-registration) -> POST /v1/visitor/visit-requests.
 * The signed-in host is the hostEmployeeId (visitor-service lets any
 * employee-level role raise a request; `vip` is gated to VIP_GRANT_ROLES, which
 * the page passes as canGrantVip). The visitor's phone and identity number are
 * PII: they are sent only to the service and never echoed back on this screen.
 */
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/ds";
import { createVisitRequest, CreateVisitRequestError } from "../../_data/client";

type Props = {
  hostEmployeeId: string;
  locations: Array<{ id: string; name: string }>;
  canGrantVip: boolean;
};

const DOC_TYPES = ["aadhaar", "driving_licence", "voter_id", "passport", "govt_employee_id"] as const;
const CATEGORIES = ["standard", "contractor", "delegation"] as const;
const PHONE_RE = /^(?:\+91|91|0)?[6-9]\d{9}$/;

const field: React.CSSProperties = {
  padding: 8,
  borderRadius: 8,
  border: "1px solid var(--line)",
  fontSize: 13.5,
  width: "100%",
  minHeight: 40,
};
const row: React.CSSProperties = { display: "grid", gap: 4, fontSize: 13 };
const grid: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" };

/** datetime-local value (browser local time) for "now + 1h", used as the picker minimum. */
function minLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function NewVisitRequestForm({ hostEmployeeId, locations, canGrantVip }: Props) {
  const t = useTranslations("visitor.newRequest");
  const [locationId, setLocationId] = useState(locations.length === 1 ? locations[0]!.id : "");
  const [visitorName, setVisitorName] = useState("");
  const [visitorPhone, setVisitorPhone] = useState("");
  const [visitorEmail, setVisitorEmail] = useState("");
  const [purpose, setPurpose] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [category, setCategory] = useState<string>("standard");
  const [docType, setDocType] = useState("");
  const [docRef, setDocRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState<{ name: string; ref: string | null } | null>(null);

  function reset() {
    setVisitorName("");
    setVisitorPhone("");
    setVisitorEmail("");
    setPurpose("");
    setScheduledAt("");
    setCategory("standard");
    setDocType("");
    setDocRef("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    const phone = visitorPhone.replace(/[\s-]/g, "");
    if (!locationId || !visitorName.trim() || !phone || !purpose.trim() || !scheduledAt) {
      setError(t("required"));
      return;
    }
    if (!PHONE_RE.test(phone)) {
      setError(t("phoneInvalid"));
      return;
    }
    if (visitorEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(visitorEmail.trim())) {
      setError(t("emailInvalid"));
      return;
    }
    if (docType && !docRef.trim()) {
      setError(t("docNumberRequired"));
      return;
    }
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      setError(t("scheduleInvalid"));
      return;
    }
    setBusy(true);
    try {
      const out = await createVisitRequest({
        locationId,
        visitorName: visitorName.trim(),
        visitorPhone: phone.length === 10 ? "+91" + phone : phone,
        ...(visitorEmail.trim() ? { visitorEmail: visitorEmail.trim() } : {}),
        purpose: purpose.trim(),
        hostEmployeeId,
        scheduledAt: when.toISOString(),
        visitorCategory: category as "standard" | "vip" | "contractor" | "delegation",
        ...(docType && docRef.trim() ? { identityDocType: docType, identityDocRef: docRef.trim() } : {}),
      });
      setDone({ name: visitorName.trim(), ref: out.id });
      reset();
    } catch (err) {
      const kind = err instanceof CreateVisitRequestError ? err.kind : "generic";
      setError(t("error_" + kind));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {done && (
        <div className="alert" role="status" style={{ borderColor: "var(--primary)", marginBottom: 12 }}>
          ✓ {t("success", { name: done.name })} {done.ref ? t("reference", { ref: done.ref }) : ""}{" "}
          <Link href="/visitor/host">{t("viewQueue")} →</Link>
        </div>
      )}
      <form
        onSubmit={(e) => void submit(e)}
        aria-label={t("title")}
        style={{ display: "grid", gap: 14, padding: 16, border: "1px solid var(--line)", borderRadius: 10, maxWidth: 880 }}
      >
        <div style={grid}>
          <label style={row}>
            <span>{t("visitorName")}</span>
            <input value={visitorName} maxLength={200} placeholder={t("visitorNamePh")} onChange={(e) => setVisitorName(e.target.value)} style={field} />
          </label>
          <label style={row}>
            <span>{t("visitorPhone")}</span>
            <input type="tel" inputMode="tel" autoComplete="off" value={visitorPhone} maxLength={20} placeholder={t("visitorPhonePh")} onChange={(e) => setVisitorPhone(e.target.value)} style={field} />
          </label>
          <label style={row}>
            <span>{t("visitorEmail")}</span>
            <input type="email" autoComplete="off" value={visitorEmail} maxLength={200} placeholder={t("visitorEmailPh")} onChange={(e) => setVisitorEmail(e.target.value)} style={field} />
          </label>
          <label style={row}>
            <span>{t("category")}</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={field}>
              {[...CATEGORIES, ...(canGrantVip ? (["vip"] as const) : [])].map((c) => (
                <option key={c} value={c}>{t("cat_" + c)}</option>
              ))}
            </select>
          </label>
          <label style={row}>
            <span>{t("premises")}</span>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={field}>
              <option value="">{t("selectPremises")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
          <label style={row}>
            <span>{t("scheduledAt")}</span>
            <input type="datetime-local" value={scheduledAt} min={minLocal()} onChange={(e) => setScheduledAt(e.target.value)} style={field} />
          </label>
        </div>
        <label style={row}>
          <span>{t("purpose")}</span>
          <textarea value={purpose} maxLength={2000} rows={3} placeholder={t("purposePh")} onChange={(e) => setPurpose(e.target.value)} style={field} />
        </label>
        <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
          <legend>{t("identityLegend")}</legend>
          <p className="sub" style={{ margin: "0 0 8px" }}>{t("identityHelp")}</p>
          <div style={grid}>
            <label style={row}>
              <span>{t("docType")}</span>
              <select value={docType} onChange={(e) => setDocType(e.target.value)} style={field}>
                <option value="">{t("docNone")}</option>
                {DOC_TYPES.map((d) => (
                  <option key={d} value={d}>{t("doc_" + d)}</option>
                ))}
              </select>
            </label>
            <label style={row}>
              <span>{t("docNumber")}</span>
              <input autoComplete="off" value={docRef} maxLength={128} disabled={!docType} onChange={(e) => setDocRef(e.target.value)} style={field} />
            </label>
          </div>
        </fieldset>
        {error && (
          <p role="alert" style={{ color: "var(--bad)", fontSize: 12.5, margin: 0 }}>{error}</p>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? t("submitting") : t("submit")}
          </Button>
          <Link href="/visitor/host" className="btn ghost">{t("cancel")}</Link>
        </div>
      </form>
    </>
  );
}
