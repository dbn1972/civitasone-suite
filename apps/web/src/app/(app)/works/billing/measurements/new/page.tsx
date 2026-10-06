"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader, Button, SkeletonCard } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

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

/** A quantity/dimension value: a positive decimal with at most 3 places
 * (matching the measurements.quantity numeric(18,4) column's usable
 * precision). Empty string allowed for optional dimensions. */
const QTY_RE = /^\d+(\.\d{1,3})?$/;

type Option = { id: string; label: string; sublabel?: string };

/**
 * GAP-WORKS-BILLING-MEASUREMENTS-NEW-01: compute No. × L × B × D from the
 * non-empty dimension fields using integer-scaled arithmetic (×1000 per
 * factor) so the suggestion is decimal-exact, then present it rounded to 3
 * places. Returns null when no dimension is given (nothing to suggest).
 */
function computeFromDimensions(d: {
  numberVal: string;
  lengthVal: string;
  breadthVal: string;
  depthVal: string;
}): string | null {
  const factors = [d.numberVal, d.lengthVal, d.breadthVal, d.depthVal]
    .map((v) => v.trim())
    .filter((v) => v !== "");
  if (factors.length === 0) return null; // ux-001-ok: purely client-side arithmetic on the clerk typed dimensions, no loader involved
  // Scale each factor to an integer of thousandths; reject bad input.
  let scaledProduct = 1n;
  let scale = 0;
  for (const f of factors) {
    if (!QTY_RE.test(f)) return null;
    const [whole, frac = ""] = f.split(".");
    const thousandths = BigInt(whole) * 1000n + BigInt(frac.padEnd(3, "0"));
    scaledProduct *= thousandths;
    scale += 3;
  }
  // scaledProduct is the product in units of 10^-scale; render to 3 dp.
  const divisorExtra = BigInt(10) ** BigInt(scale - 3);
  const milli = scaledProduct / divisorExtra; // now in thousandths
  const whole = milli / 1000n;
  const frac = (milli % 1000n).toString().padStart(3, "0");
  return `${whole}.${frac}`;
}

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

  const workId = (searchParams.get("workId") ?? "").trim();

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
  const formError = useFormError("measurement");

  // GAP-WORKS-BILLING-MEASUREMENTS-NEW-02: when the work is known, offer the
  // work's MBs as a select (and show the selected MB number) instead of a
  // pasted UUID.
  const [mbs, setMbs] = useState<Option[] | null>(null);
  useEffect(() => {
    if (!workId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/works/billing/${workId}/mbs`);
        if (cancelled || !res.ok) return;
        const body = (await res.json()) as { data?: unknown };
        const rows = Array.isArray(body.data) ? body.data : [];
        setMbs(
          rows.map((r) => {
            const row = r as Record<string, unknown>;
            return { id: String(row.id ?? ""), label: String(row.mbNumber ?? row.id ?? "") };
          }),
        );
      } catch {
        /* leave null → text input */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workId]);

  function set(field: keyof MeasurementForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  const computed = computeFromDimensions(form);
  // A mismatch is when a computed value exists and the typed quantity differs
  // from it (beyond a 0.001 tolerance). Then a remark is required before save.
  const qtyNum = Number(form.quantity);
  const computedNum = computed !== null ? Number(computed) : null;
  const mismatch =
    computedNum !== null && QTY_RE.test(form.quantity.trim()) && Math.abs(qtyNum - computedNum) > 0.001;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    // GAP-WORKS-BILLING-MEASUREMENTS-NEW-03/04: validate the quantity and
    // dimensions as positive decimals (≤3 dp) before building the payload —
    // reject NaN/Infinity/negatives rather than letting parseFloat coerce
    // them. Quantity is a physical measure (not money), sent as a JSON number
    // per the works-service recordMeasurementSchema (z.number().positive()).
    const q = form.quantity.trim();
    if (!QTY_RE.test(q) || Number(q) <= 0) {
      setError("Quantity must be a positive number with up to 3 decimal places.");
      setBusy(false);
      return;
    }
    for (const [field, val] of [
      ["No.", form.numberVal],
      ["Length", form.lengthVal],
      ["Breadth", form.breadthVal],
      ["Depth", form.depthVal],
    ] as const) {
      const t = val.trim();
      if (t !== "" && !QTY_RE.test(t)) {
        setError(`${field} must be a non-negative number with up to 3 decimal places.`);
        setBusy(false);
        return;
      }
    }
    // GAP-WORKS-BILLING-MEASUREMENTS-NEW-01: a quantity that disagrees with the
    // computed L×B×D×No. must be justified with a remark before it becomes the
    // authoritative billed value.
    if (mismatch && !form.remarks.trim()) {
      setError(
        `Quantity (${q}) differs from the computed value (${computed}). Add a remark explaining the difference, or use the computed value.`,
      );
      setBusy(false);
      return;
    }

    const body: Record<string, unknown> = {
      mbId: form.mbId.trim(),
      boqItemId: form.boqItemId.trim(),
      quantity: Number(q),
    };
    if (form.numberVal.trim()) body.numberVal = Number(form.numberVal.trim());
    if (form.lengthVal.trim()) body.lengthVal = Number(form.lengthVal.trim());
    if (form.breadthVal.trim()) body.breadthVal = Number(form.breadthVal.trim());
    if (form.depthVal.trim()) body.depthVal = Number(form.depthVal.trim());
    if (form.remarks.trim()) body.remarks = form.remarks.trim();

    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/works/billing/measurements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setMessage("Measurement recorded.");
      toast.success("Measurement recorded.");
      setTimeout(() => {
        router.push(workId ? "/works/billing/" + workId : "/works/billing");
      }, 600);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  const backHref = workId ? "/works/billing/" + workId : "/works/billing";

  return (
    <>
      <PageHeader
        title="Record Measurement"
        subtitle="Enter measured quantities against a Measurement Book item."
        back={backHref}
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
              <label style={labelStyle} htmlFor="mbId">Measurement Book *</label>
              {mbs && mbs.length > 0 ? (
                <select id="mbId" style={inputStyle} value={form.mbId} onChange={set("mbId")} required>
                  <option value="">Select a measurement book…</option>
                  {mbs.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="mbId"
                  style={inputStyle}
                  type="text"
                  value={form.mbId}
                  onChange={set("mbId")}
                  placeholder="UUID of the MB"
                  required
                />
              )}
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
            {computed !== null && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  Computed from dimensions: <strong>{computed}</strong>
                </span>
                <button
                  type="button"
                  className="btn ghost"
                  style={{ minHeight: 28, fontSize: 12, padding: "2px 10px" }}
                  onClick={() => setForm((prev) => ({ ...prev, quantity: computed }))}
                >
                  Use computed
                </button>
              </div>
            )}
            {mismatch && (
              <p role="status" style={{ fontSize: 12, color: "#92400e", marginTop: 6 }}>
                ⚠️ Entered quantity differs from the computed value — add a remark explaining why,
                or use the computed value.
              </p>
            )}
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
              Enter dimensions to get a computed suggestion for Quantity. Quantity remains the
              authoritative value the backend bills against — the computed figure is a cross-check.
            </p>
          </fieldset>

          {/* Remarks */}
          <div>
            <label style={labelStyle} htmlFor="remarks">
              Remarks{mismatch ? " *" : ""}
            </label>
            <textarea
              id="remarks"
              style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
              value={form.remarks}
              onChange={set("remarks")}
              maxLength={2048}
              placeholder={mismatch ? "Required: explain why the quantity differs from the computed value" : "Optional site observation or note"}
            />
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 4 }}>
            <Button
              variant="ghost"
              onClick={() => router.push(backHref)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy}
            >
              {busy ? "Saving…" : "Record Measurement"}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}

export default function RecordMeasurementPage() {
  // GAP-WORKS-BILLING-MEASUREMENTS-NEW-04: visible Suspense fallback.
  return (
    <Suspense fallback={<SkeletonCard />}>
      <RecordMeasurementForm />
    </Suspense>
  );
}
