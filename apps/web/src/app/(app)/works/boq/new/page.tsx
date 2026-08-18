"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader } from "@/app/_components/ds";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errBanner = { background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;

export default function NewBoqItemPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState({
    workId: "",
    itemDescription: "",
    itemCode: "",
    unit: "",
    rate: "",
    quantity: "",
    remarks: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  const rateNum = Number(form.rate || "0");
  const qtyNum = Number(form.quantity || "0");
  const estimated = rateNum > 0 && qtyNum > 0 ? (rateNum * qtyNum).toFixed(2) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const body: Record<string, unknown> = {
        workId: form.workId.trim(),
        itemDescription: form.itemDescription.trim(),
        unit: form.unit.trim(),
        rate: String(Math.round(Number(form.rate || "0") * 100)),
        quantity: Number(form.quantity),
      };
      if (form.itemCode.trim()) body.itemCode = form.itemCode.trim();
      if (form.remarks.trim()) body.remarks = form.remarks.trim();

      const res = await fetch("/api/proxy/v1/works/boq", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!res.ok) throw new Error(data?.message ?? "Create failed");
      setMessage("BoQ item added.");
      toast.success("BoQ item added.");
      setTimeout(() => router.push("/works/boq"), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Add BoQ Item"
        subtitle="Add a Bill of Quantities item to a work."
        back="/works/boq"
        backLabel="BoQ"
      />
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

          <div>
            <label style={labelStyle} htmlFor="workId">Work ID (UUID) *</label>
            <input
              id="workId"
              style={inputStyle}
              type="text"
              value={form.workId}
              onChange={set("workId")}
              placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
              required
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="itemDescription">Item description *</label>
            <textarea
              id="itemDescription"
              style={{ ...inputStyle, minHeight: 72 }}
              rows={2}
              value={form.itemDescription}
              onChange={set("itemDescription")}
              maxLength={1024}
              required
            />
          </div>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            }}
          >
            <div>
              <label style={labelStyle} htmlFor="itemCode">Item code</label>
              <input
                id="itemCode"
                style={inputStyle}
                type="text"
                value={form.itemCode}
                onChange={set("itemCode")}
                placeholder="e.g. SR-2024-C001"
                maxLength={64}
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="unit">Unit *</label>
              <input
                id="unit"
                style={inputStyle}
                type="text"
                value={form.unit}
                onChange={set("unit")}
                placeholder="e.g. m, m², nos, kg"
                maxLength={64}
                required
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="rate">Rate per unit (₹) *</label>
              <input
                id="rate"
                style={inputStyle}
                type="number"
                value={form.rate}
                onChange={set("rate")}
                step="0.01"
                min="0"
                placeholder="0.00"
                required
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="quantity">Quantity *</label>
              <input
                id="quantity"
                style={inputStyle}
                type="number"
                value={form.quantity}
                onChange={set("quantity")}
                step="0.001"
                min="0"
                placeholder="0"
                required
              />
            </div>
          </div>

          {estimated !== null ? (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
              Estimated: ₹{estimated}
            </p>
          ) : null}

          <div>
            <label style={labelStyle} htmlFor="remarks">Remarks</label>
            <textarea
              id="remarks"
              style={{ ...inputStyle, minHeight: 72 }}
              rows={2}
              value={form.remarks}
              onChange={set("remarks")}
              maxLength={2048}
              placeholder="Optional notes"
            />
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
            <button
              type="button"
              onClick={() => router.push("/works/boq")}
              style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", cursor: "pointer" }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1 }}
              disabled={busy}
            >
              {busy ? "Saving…" : "Add BoQ Item"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
