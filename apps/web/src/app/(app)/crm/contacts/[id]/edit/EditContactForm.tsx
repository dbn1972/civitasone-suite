"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { rupeesToMinorString } from "@/lib/money";
import { saveClassification, type ClassificationPatch, type Temperature, type Priority } from "@/lib/crm/leadQualification";
import { ClassificationFields, type ClassificationFormValue } from "../../../../../_components/crm/ClassificationFields";

type Initial = {
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  designation?: string;
  city?: string;
  leadStatus?: string;
  marketingConsent?: boolean;
  temperature?: string;
  priority?: string;
  segment?: string;
  product?: string;
  region?: string;
  expectedValueMinor?: string;
};

type Props = { params: { id: string }; initial: Initial };

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

/** Paise integer string → rupees decimal string for the money input prefill. */
function minorToRupees(minor?: string): string {
  if (!minor) return "";
  if (!/^\d+$/.test(minor)) return "";
  const n = BigInt(minor);
  const rupees = n / 100n;
  const paise = n % 100n;
  return paise === 0n ? rupees.toString() : `${rupees}.${paise.toString().padStart(2, "0")}`;
}

function isTemperature(v: string): v is Temperature {
  return v === "hot" || v === "warm" || v === "cold";
}
function isPriority(v: string): v is Priority {
  return v === "high" || v === "medium" || v === "low";
}

export default function EditContactForm({ params, initial }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: initial.name,
    email: initial.email ?? "",
    phone: initial.phone ?? "",
    company: initial.organization ?? "",
    designation: initial.designation ?? "",
    city: initial.city ?? "",
    leadStatus: initial.leadStatus ?? "new",
    marketingConsent: initial.marketingConsent ?? false,
  });
  const [classification, setClassification] = useState<ClassificationFormValue>({
    temperature: initial.temperature && isTemperature(initial.temperature) ? initial.temperature : "",
    priority: initial.priority && isPriority(initial.priority) ? initial.priority : "",
    segment: initial.segment ?? "",
    product: initial.product ?? "",
    region: initial.region ?? "",
    expectedValueRupees: minorToRupees(initial.expectedValueMinor),
  });
  const [evError, setEvError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function updateClassification(patch: Partial<ClassificationFormValue>) {
    setClassification((c) => ({ ...c, ...patch }));
    if ("expectedValueRupees" in patch) setEvError("");
  }

  /** Build the classification PATCH body, converting rupees→paise. Returns
   *  null when the expected value is present but not a valid amount. */
  function buildClassificationPatch(): ClassificationPatch | null {
    const patch: ClassificationPatch = {};
    if (classification.temperature) patch.temperature = classification.temperature;
    if (classification.priority) patch.priority = classification.priority;
    patch.segment = classification.segment.trim();
    patch.product = classification.product.trim();
    patch.region = classification.region.trim();
    const ev = classification.expectedValueRupees.trim();
    if (ev) {
      const minor = rupeesToMinorString(ev);
      if (!minor) return null;
      patch.expectedValueMinor = minor;
    }
    return patch;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    setEvError("");

    const classificationPatch = buildClassificationPatch();
    if (classificationPatch === null) {
      setEvError("Enter expected value as a positive amount in rupees (up to 2 decimals).");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/crm/contacts/${params.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email || undefined,
          phone: form.phone || undefined,
          company: form.company || undefined,
          designation: form.designation || undefined,
          city: form.city || undefined,
          leadStatus: form.leadStatus,
          marketingConsent: form.marketingConsent,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      // LQ-003: persist classification on its dedicated endpoint.
      await saveClassification(params.id, classificationPatch);
      setMessage("Contact updated.");
      setTimeout(() => router.push(`/crm/contacts/${params.id}`), 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the contact.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="back" href={`/crm/contacts/${params.id}`}>← Contact</a>
      <div className="ph" style={{ marginTop: 6 }}><h1>Edit Contact</h1></div>
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      {error ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{error}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad" style={{ display: "grid", gap: 14, maxWidth: 720 }}>
          <div>
            <label htmlFor="edit-name" style={labelStyle}>Full name</label>
            <input id="edit-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="edit-email" style={labelStyle}>Email</label>
            <input id="edit-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="edit-phone" style={labelStyle}>Phone</label>
            <input id="edit-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="edit-company" style={labelStyle}>Organisation</label>
            <input id="edit-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="edit-designation" style={labelStyle}>Designation</label>
            <input id="edit-designation" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="edit-city" style={labelStyle}>City</label>
            <input id="edit-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="edit-leadStatus" style={labelStyle}>Lead status</label>
            <select id="edit-leadStatus" value={form.leadStatus} onChange={(e) => setForm({ ...form, leadStatus: e.target.value })} style={inputStyle}>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="qualified">Qualified</option>
              <option value="unqualified">Unqualified</option>
              <option value="disqualified">Disqualified</option>
              <option value="customer">Customer</option>
            </select>
          </div>

          <ClassificationFields value={classification} onChange={updateClassification} expectedValueError={evError} />

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={form.marketingConsent} onChange={(e) => setForm({ ...form, marketingConsent: e.target.checked })} />
            Marketing consent (DPDP)
          </label>
          <div>
            <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>{busy ? "Saving…" : "Save changes"}</button>
          </div>
        </form>
      </div>
    </>
  );
}
