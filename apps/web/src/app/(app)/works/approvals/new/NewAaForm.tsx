"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errBanner = { background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const hintStyle = { fontSize: 12, color: "#166534", marginTop: 4 } as const;

export function NewAaForm() {
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  // Pre-fill the Work ID from the ?workId= param so the "Create AA →" button on
  // a proposal carries its context through instead of dropping it (the officer
  // no longer has to hand-copy the UUID).
  const prefilledWorkId = searchParams.get("workId") ?? "";
  const [form, setForm] = useState({
    workId: prefilledWorkId,
    aaNumber: "",
    aaDate: "",
    approvingAuthorityId: "",
    approvedAmount: "",
    remarks: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const body: Record<string, string> = {
        workId: form.workId.trim(),
        aaNumber: form.aaNumber.trim(),
        aaDate: form.aaDate,
        approvingAuthorityId: form.approvingAuthorityId.trim(),
        approvedAmountMinor: String(Math.round(Number(form.approvedAmount || "0") * 100)),
      };
      if (form.remarks.trim()) body.remarks = form.remarks.trim();

      const res = await fetch("/api/proxy/v1/works/approvals/aa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!res.ok) throw new Error(data?.message ?? "Create failed");
      // The service accepts the create asynchronously (HTTP 202) — the record is
      // queued, not yet written — so we say "submitted", not "created".
      setMessage("Administrative approval submitted. It will appear in the register once processed.");
      toast.success("Administrative approval submitted.");
      setTimeout(() => router.push("/works/approvals"), 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
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
              <label style={labelStyle} htmlFor="aa-workId">Work ID (UUID) *</label>
              <input
                id="aa-workId"
                style={inputStyle}
                type="text"
                value={form.workId}
                onChange={set("workId")}
                placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                required
              />
              {prefilledWorkId ? (
                <p style={hintStyle}>Pre-filled from the selected proposal.</p>
              ) : null}
            </div>

            <div>
              <label style={labelStyle} htmlFor="aa-number">AA Number *</label>
              <input
                id="aa-number"
                style={inputStyle}
                type="text"
                value={form.aaNumber}
                onChange={set("aaNumber")}
                placeholder="e.g. AA/2024-25/001"
                maxLength={64}
                required
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="aa-date">Approval date *</label>
              <input
                id="aa-date"
                style={inputStyle}
                type="date"
                value={form.aaDate}
                onChange={set("aaDate")}
                required
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="aa-authority">Approving authority ID (UUID) *</label>
              <input
                id="aa-authority"
                style={inputStyle}
                type="text"
                value={form.approvingAuthorityId}
                onChange={set("approvingAuthorityId")}
                placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                required
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="aa-amount">Approved amount (&#8377;) *</label>
              <input
                id="aa-amount"
                style={inputStyle}
                type="number"
                min="0"
                step="0.01"
                value={form.approvedAmount}
                onChange={set("approvedAmount")}
                placeholder="0.00"
                required
              />
            </div>
          </div>

          <div>
            <label style={labelStyle} htmlFor="aa-remarks">Remarks</label>
            <textarea
              id="aa-remarks"
              style={{ ...inputStyle, minHeight: 80 }}
              value={form.remarks}
              onChange={set("remarks")}
              maxLength={2048}
              placeholder="Optional notes or remarks"
            />
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <button
              type="submit"
              className="btn primary"
              disabled={busy}
              style={{ minHeight: 44 }}
            >
              {busy ? "Submitting..." : "Create"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => router.push("/works/approvals")}
              disabled={busy}
              style={{ minHeight: 44 }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
