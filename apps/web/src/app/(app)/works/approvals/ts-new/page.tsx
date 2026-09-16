"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errBanner = { background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const infoBanner = { background: "#eff6ff", color: "#1e40af", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;

export default function NewTsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState({
    workId: "",
    tsNumber: "",
    tsDate: "",
    tsAuthorityId: "",
    srYear: "",
    zone: "",
    tsAmount: "",
    remarks: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const formError = useFormError("technical sanction");

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    formError.clear();
    try {
      const body: Record<string, string> = {
        workId: form.workId.trim(),
        tsNumber: form.tsNumber.trim(),
        tsDate: form.tsDate,
        tsAuthorityId: form.tsAuthorityId.trim(),
        tsAmountMinor: String(Math.round(Number(form.tsAmount || "0") * 100)),
      };
      if (form.srYear.trim()) body.srYear = form.srYear.trim();
      if (form.zone.trim()) body.zone = form.zone.trim();
      if (form.remarks.trim()) body.remarks = form.remarks.trim();

      const res = await fetch("/api/proxy/v1/works/approvals/ts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setMessage("Technical sanction created.");
      toast.success("Technical sanction created.");
      setTimeout(() => router.push("/works/approvals"), 600);
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New Technical Sanction"
        subtitle="Create a Technical Sanction (TS) record for a work."
        back="/works/approvals"
        backLabel="Approvals"
      />
      <div role="note" style={infoBanner}>
        Technical sanction requires the work proposal to be DAO-finalized.
      </div>
      {message ? (
        <div role="status" aria-live="polite" style={okBanner}>
          {message}
        </div>
      ) : null}
      {error ? (
        <div role="alert" aria-live="assertive" style={errBanner}>
          {error}
        </div>
      ) : null}
      <div className="card">
        <form
          onSubmit={submit}
          className="pad"
          style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}
        >
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Fields marked * are required.</p>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <div>
              <label htmlFor="ts-new-work-id" style={labelStyle}>Work ID (UUID) *</label>
              <input
                id="ts-new-work-id"
                style={inputStyle}
                type="text"
                value={form.workId}
                onChange={set("workId")}
                placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                required
              />
            </div>

            <div>
              <label htmlFor="ts-new-ts-number" style={labelStyle}>TS Number *</label>
              <input
                id="ts-new-ts-number"
                style={inputStyle}
                type="text"
                value={form.tsNumber}
                onChange={set("tsNumber")}
                placeholder="e.g. TS/2024-25/001"
                maxLength={64}
                required
              />
            </div>

            <div>
              <label htmlFor="ts-new-sanction-date" style={labelStyle}>Sanction date *</label>
              <input
                id="ts-new-sanction-date"
                style={inputStyle}
                type="date"
                value={form.tsDate}
                onChange={set("tsDate")}
                required
              />
            </div>

            <div>
              <label htmlFor="ts-new-authority-id" style={labelStyle}>TS authority ID (UUID) *</label>
              <input
                id="ts-new-authority-id"
                style={inputStyle}
                type="text"
                value={form.tsAuthorityId}
                onChange={set("tsAuthorityId")}
                placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                required
              />
            </div>

            <div>
              <label htmlFor="ts-new-sr-year" style={labelStyle}>SR Year (optional)</label>
              <input
                id="ts-new-sr-year"
                style={inputStyle}
                type="text"
                value={form.srYear}
                onChange={set("srYear")}
                placeholder="e.g. 2024-25"
                maxLength={16}
              />
            </div>

            <div>
              <label htmlFor="ts-new-zone" style={labelStyle}>Zone (optional)</label>
              <input
                id="ts-new-zone"
                style={inputStyle}
                type="text"
                value={form.zone}
                onChange={set("zone")}
                placeholder="e.g. Pune Zone"
                maxLength={64}
              />
            </div>

            <div>
              <label htmlFor="ts-new-amount" style={labelStyle}>Sanction amount (&#8377;) *</label>
              <input
                id="ts-new-amount"
                style={inputStyle}
                type="number"
                min="0"
                step="0.01"
                value={form.tsAmount}
                onChange={set("tsAmount")}
                placeholder="0.00"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="ts-new-remarks" style={labelStyle}>Remarks</label>
            <textarea
              id="ts-new-remarks"
              style={{ ...inputStyle, minHeight: 80 }}
              value={form.remarks}
              onChange={set("remarks")}
              maxLength={2048}
              placeholder="Optional notes or remarks"
            />
          </div>

          <button
            type="submit"
            className="btn primary"
            disabled={busy}
            style={{ minHeight: 44 }}
          >
            {busy ? "Submitting..." : "Create"}
          </button>
        </form>
      </div>
    </>
  );
}
