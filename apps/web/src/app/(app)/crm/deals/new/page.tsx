"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader } from "@/app/_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

type ContactOption = { id: string; name: string };

const STAGES = [
  { value: "Lead", label: "Lead" },
  { value: "Proposal", label: "Proposal" },
  { value: "Negotiation", label: "Negotiation" },
  { value: "Won", label: "Won" },
  { value: "Lost", label: "Lost" },
] as const;

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export default function NewDealPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "",
    stage: "Lead",
    value: "",
    contactId: "",
    closeDate: "",
    probability: "0",
  });
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await browserFetch("v1/crm/contacts");
        if (!res.ok) return;
        const body = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
        if (!active) return;
        const opts = (body.data ?? [])
          .filter((c): c is { id: string; name: string } => Boolean(c.id && c.name))
          .map((c) => ({ id: c.id, name: c.name }));
        setContacts(opts);
      } catch {
        /* contact picker is optional; ignore */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const rupees = Number(form.value || "0");
      const valueMinor = Number.isFinite(rupees) ? Math.round(rupees * 100) : 0;
      const probability = Math.max(0, Math.min(100, Number(form.probability || "0") || 0));
      const res = await browserFetch("v1/crm/deals", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          stage: form.stage,
          valueMinor,
          currency: "INR",
          probability,
          ...(form.contactId ? { contactId: form.contactId } : {}),
          ...(form.closeDate ? { closeDate: form.closeDate } : {}),
        }),
      });
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      setMessage("Deal created.");
      toast.success("Deal created successfully.");
      setTimeout(() => router.push("/crm/deals"), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the deal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="New Deal" subtitle="Create an opportunity and place it on the pipeline." back="/crm/deals" backLabel="Deals" />
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>
          {message}
        </div>
      ) : null}
      {error ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560 }}>
          <div>
            <label htmlFor="deal-name" style={labelStyle}>Deal name</label>
            <input id="deal-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Statewide LMS rollout" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="deal-value" style={labelStyle}>Value (₹)</label>
            <input id="deal-value" type="number" min={0} step="1" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="0" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="deal-stage" style={labelStyle}>Stage</label>
            <select id="deal-stage" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} style={inputStyle}>
              {STAGES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="deal-contact" style={labelStyle}>Contact (optional)</label>
            <select id="deal-contact" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })} style={inputStyle}>
              <option value="">— No contact —</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="deal-close" style={labelStyle}>Expected close date (optional)</label>
            <input id="deal-close" type="date" value={form.closeDate} onChange={(e) => setForm({ ...form, closeDate: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="deal-prob" style={labelStyle}>Probability (%)</label>
            <input id="deal-prob" type="number" min={0} max={100} step="1" value={form.probability} onChange={(e) => setForm({ ...form, probability: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>
              {busy ? "Creating…" : "Create deal"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
