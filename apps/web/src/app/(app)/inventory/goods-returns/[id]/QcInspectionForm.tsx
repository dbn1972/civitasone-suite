"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The backend's qcInspectionBody enum (services/inventory-service/.../validators.ts)
 * only accepts "restock" | "quarantine" | "scrap" — it does not have a literal
 * "return-to-vendor" or "accept-with-penalty" value. Labels below map the three
 * backend-accepted values to the closest equivalent of the three dispositions
 * named in requirements 1.6 (return-to-vendor / scrap / accept-with-penalty).
 */
const DISPOSITIONS = [
  { value: "restock", label: "Return to vendor / restock" },
  { value: "scrap", label: "Scrap" },
  { value: "quarantine", label: "Accept with penalty (quarantine)" },
] as const;

export function QcInspectionForm({ goodsReturnId }: { goodsReturnId: string }) {
  const router = useRouter();
  const [qcStatus, setQcStatus] = useState<"passed" | "failed">("passed");
  const [disposition, setDisposition] = useState<(typeof DISPOSITIONS)[number]["value"]>("restock");
  const [remarks, setRemarks] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/inventory/goods-returns/${goodsReturnId}/inspect`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          qcStatus,
          disposition,
          qcNotes: remarks.trim() || undefined,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Submission failed (${res.status})`);
        return;
      }
      router.push(`/inventory/goods-returns/${goodsReturnId}`);
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 560 }} noValidate>
      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 8 }}>Verdict</legend>
        <div style={{ display: "flex", gap: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="radio"
              name="qcStatus"
              value="passed"
              checked={qcStatus === "passed"}
              onChange={() => setQcStatus("passed")}
            />
            Pass
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="radio"
              name="qcStatus"
              value="failed"
              checked={qcStatus === "failed"}
              onChange={() => setQcStatus("failed")}
            />
            Fail
          </label>
        </div>
      </fieldset>

      <div className="fields" style={{ marginTop: 16 }}>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Disposition</span>
          <select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value as (typeof DISPOSITIONS)[number]["value"])}
            style={{ minHeight: 44 }}
          >
            {DISPOSITIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Inspector notes</span>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            placeholder="Condition observed, reason for verdict"
            style={{ minHeight: 88 }}
          />
        </label>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: "#b91c1c" }}>{message}</p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : "Record verdict"}
        </button>
        <Link href="/inventory/goods-returns" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
