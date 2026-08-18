"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader } from "@/app/_components/ds";

const inputStyle = {
  width: "100%",
  padding: 8,
  minHeight: 44,
  borderRadius: 8,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink)",
  fontSize: 14,
} as const;

const labelStyle = {
  display: "block",
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 4,
  fontWeight: 600,
} as const;

const errBanner = {
  background: "#fef2f2",
  color: "#b42318",
  padding: 12,
  borderRadius: 12,
  marginBottom: 16,
  fontSize: 13,
} as const;

const okBanner = {
  background: "#ecfdf3",
  padding: 12,
  borderRadius: 12,
  marginBottom: 16,
  fontSize: 13,
} as const;

type MeasurementForm = {
  mbId: string;
  boqItemId: string;
  quantity: string;
  numberVal: string;
  lengthVal: string;
  breadthVal: string;
  depthVal: string;
  remarks: string;
};

function RecordMeasurementForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [form, setForm] = useState<MeasurementForm>({
    mbId: searchParams.get("mbId") ?? "",
    boqItemId: searchParams.get("boqItemId") ?? "",
    quantity: "",
    numberVal: "",
    lengthVal: "",
    breadthVal: "",
    depthVal: "",
    remarks: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function set(field: keyof MeasurementForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    const qty = parseFloat(form.quantity);
    if (!qty || qty <= 0) {
      setError("Quantity must be a positive number.");
      setBusy(false);
      return;
    }

    const body: Record<string, unknown> = {
      mbId: form.mbId.trim(),
      boqItemId: form.boqItemId.trim(),
      quantity: qty,
    };
    if (form.numberVal)  body.numberVal  = parseFloat(form.numberVal);
    if (form.lengthVal)  body.lengthVal  = parseFloat(form.lengthVal);
    if (form.breadthVal) body.breadthVal = parseFloat(form.breadthVal);
    if (form.depthVal)   body.depthVal   = parseFloat(form.depthVal);
    if (form.remarks.trim()) body.remarks = form.remarks.trim();

    try {
      const res = await fetch("/api/proxy/v1/works/billing/measurements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) throw new Error(data?.message ?? "Submit failed");
      setMessage("Measurement recorded.");
      toast.success("Measurement recorded.");
      const workId = searchParams.get("workId");
      setTimeout(() => {
        if (workId) router.push("/works/billing/" + workId);
        else router.push("/works/billing");
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const backWorkId = searchParams.get("workId");

  return (
    <>
      <PageHeader
        title="Record Measurement"
        subtitle="Enter measured quantities against a Measurement Book item."
        back={backWorkId ? "/works/billing/" + backWorkId : "/works/billing"}
        backLabel="Billing"
      />

      {message && (
        <div role="status" aria-live="polite" style={okBanner}>
          {message}
        </div>
      )}
      {error && (
        <div role="alert" aria-live="assertive" style={errBanner}>
          {error}
        </div>
      )}

      <div className="card">
        <form
          onSubmit={submit}
          className="pad"
          style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 680 }}
        >
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>Fields marked * are required.</p>

          {/* MB + BoQ IDs */}
          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            }}
          >
            <div>
              <label style={labelStyle} htmlFor="mbId">Measurement Book ID (UUID) *</label>
              <input
                id="mbId"
                style={inputStyle}
                type="text"
                value={form.mbId}
                onChange={set("mbId")}
                placeholder="UUID of the MB"
                required
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="boqItemId">BoQ Item ID (UUID) *</label>
              <input
                id="boqItemId"
                style={inputStyle}
                type="text"
                value={form.boqItemId}
                onChange={set("boqItemId")}
                placeholder="UUID of the BoQ line item"
                required
              />
            </div>
          </div>

          {/* Quantity */}
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
              placeholder="Measured quantity (e.g. 12.5)"
              required
            />
          </div>

          {/* Dimensions */}
          <fieldset
            style={{
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "14px 16px",
              margin: 0,
            }}
          >
            <legend style={{ ...labelStyle, padding: "0 6px" }}>Dimensions (optional)</legend>
            <div
              style={{
                display: "grid",
                gap: 14,
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              }}
            >
              {(
                [
                  ["numberVal", "No.", "Count"],
                  ["lengthVal", "Length (L)", "metres"],
                  ["breadthVal", "Breadth (B)", "metres"],
                  ["depthVal", "Depth (D)", "metres"],
                ] as [keyof MeasurementForm, string, string][]
              ).map(([field, label, placeholder]) => (
                <div key={field}>
                  <label style={labelStyle} htmlFor={field}>{label}</label>
                  <input
                    id={field}
                    style={inputStyle}
                    type="number"
                    value={form[field]}
                    onChange={set(field)}
                    step="0.001"
                    min="0"
                    placeholder={placeholder}
                  />
                </div>
              ))}
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--muted)" }}>
              L × B × D × No. product is for reference — the backend uses <code>quantity</code> as the authoritative value.
            </p>
          </fieldset>

          {/* Remarks */}
          <div>
            <label style={labelStyle} htmlFor="remarks">Remarks</label>
            <textarea
              id="remarks"
              style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
              value={form.remarks}
              onChange={set("remarks")}
              maxLength={2048}
              placeholder="Optional site observation or note"
            />
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 4 }}>
            <button
              type="button"
              onClick={() => {
                const workId = searchParams.get("workId");
                if (workId) router.push("/works/billing/" + workId);
                else router.push("/works/billing");
              }}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "transparent",
                cursor: "pointer",
                fontSize: 14,
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                padding: "10px 24px",
                borderRadius: 8,
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.7 : 1,
                fontSize: 14,
              }}
              disabled={busy}
            >
              {busy ? "Saving…" : "Record Measurement"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

export default function RecordMeasurementPage() {
  return (
    <Suspense>
      <RecordMeasurementForm />
    </Suspense>
  );
}
