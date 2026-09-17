"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader, Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errBanner = { background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;

export default function NewTenderPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState({
    workId: "",
    referenceNumber: "",
    tenderType: "",
    tenderCategory: "",
    bidValidity: "",
    fees: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const formError = useFormError("pre-tender");

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    formError.clear();
    try {
      const body: Record<string, unknown> = {
        workId: form.workId.trim(),
      };
      if (form.referenceNumber.trim()) body.referenceNumber = form.referenceNumber.trim();
      if (form.tenderType) body.tenderType = form.tenderType;
      if (form.tenderCategory.trim()) body.tenderCategory = form.tenderCategory.trim();
      if (form.bidValidity) body.bidValidity = parseInt(form.bidValidity, 10);
      if (form.fees) body.fees = String(Math.round(Number(form.fees || "0") * 100));

      const res = await fetch("/api/proxy/v1/works/tenders/pre-tender", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setMessage("Created.");
      toast.success("Pre-tender created.");
      setTimeout(() => router.push("/works/tenders"), 600);
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
      <PageHeader title="New Pre-Tender" />
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
        {error && <div style={errBanner}>{error}</div>}
        {message && <div style={okBanner}>{message}</div>}

        <div>
          <label style={labelStyle} htmlFor="workId">Work ID (UUID) *</label>
          <input
            id="workId"
            name="workId"
            style={inputStyle}
            value={form.workId}
            onChange={handleChange}
            required
            placeholder="e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6"
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="referenceNumber">Reference number</label>
          <input
            id="referenceNumber"
            name="referenceNumber"
            style={inputStyle}
            value={form.referenceNumber}
            onChange={handleChange}
            placeholder="e.g. NIT/2024-25/001"
            maxLength={128}
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="tenderType">Tender type</label>
          <select
            id="tenderType"
            name="tenderType"
            style={inputStyle}
            value={form.tenderType}
            onChange={handleChange}
          >
            <option value="">— Select —</option>
            <option value="open">Open</option>
            <option value="limited">Limited</option>
            <option value="quotation">Quotation</option>
            <option value="single_source">Single Source</option>
          </select>
        </div>

        <div>
          <label style={labelStyle} htmlFor="tenderCategory">Tender category</label>
          <input
            id="tenderCategory"
            name="tenderCategory"
            style={inputStyle}
            value={form.tenderCategory}
            onChange={handleChange}
            placeholder="e.g. Civil, Electrical"
            maxLength={64}
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="bidValidity">Bid validity (days)</label>
          <input
            id="bidValidity"
            name="bidValidity"
            type="number"
            min={1}
            style={inputStyle}
            value={form.bidValidity}
            onChange={handleChange}
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="fees">Tender fee (₹)</label>
          <input
            id="fees"
            name="fees"
            type="number"
            min={0}
            step="0.01"
            style={inputStyle}
            value={form.fees}
            onChange={handleChange}
          />
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
          <Button
            variant="ghost"
            onClick={() => router.push("/works/tenders")}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={busy}
          >
            {busy ? "Saving…" : "Create Pre-Tender"}
          </Button>
        </div>
      </form>
    </div>
  );
}
