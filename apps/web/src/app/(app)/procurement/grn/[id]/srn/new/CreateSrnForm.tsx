"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateSrnForm({ grnId, storeOfficerId }: { grnId: string; storeOfficerId: string }) {
  const router = useRouter();
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [signNow, setSignNow] = useState(true);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setMessage("");
    try {
      const createRes = await fetch("/api/proxy/v1/inventory/srn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grnId, remarks: remarks.trim() || undefined }),
      });
      const createText = await createRes.text();
      if (!createRes.ok) {
        setStatus("error");
        setMessage(createText || `Create failed (${createRes.status})`);
        return;
      }
      const created = JSON.parse(createText) as { id?: string };

      if (signNow && created.id) {
        const signRes = await fetch(`/api/proxy/v1/inventory/srn/${created.id}/sign`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            receivedAt: new Date(receivedDate).toISOString(),
            remarks: remarks.trim() || undefined,
          }),
        });
        if (!signRes.ok) {
          // The SRN was created but signing failed — land on the read view so
          // the officer can retry signing rather than losing the draft.
          router.push(`/procurement/grn/${grnId}/srn`);
          router.refresh();
          return;
        }
      }

      router.push(`/procurement/grn/${grnId}/srn`);
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 560 }} noValidate>
      <div className="fields">
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Store officer</span>
          <span className="mono">{storeOfficerId || "—"}</span>
        </label>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Received date</span>
          <input
            type="date"
            value={receivedDate}
            onChange={(e) => setReceivedDate(e.target.value)}
            style={{ minHeight: 44 }}
          />
        </label>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Remarks</span>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            placeholder="Condition of goods, any discrepancies noted at receipt"
            style={{ minHeight: 88 }}
          />
        </label>
        <label className="field" style={{ background: "#fff", padding: "13px 16px", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={signNow} onChange={(e) => setSignNow(e.target.checked)} style={{ width: 18, height: 18 }} />
          <span className="label" style={{ margin: 0 }}>Sign now — confirms physical acceptance and clears the payment gate</span>
        </label>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: "#b91c1c" }}>{message}</p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : signNow ? "Sign & Submit" : "Create SRN"}
        </button>
        <Link href={`/procurement/grn/${grnId}`} className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
