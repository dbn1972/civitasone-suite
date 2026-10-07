"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { z } from "zod";
import { humanZodMessage } from "@/lib/humanZodMessage";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader, Button, Field, EntityPicker, SkeletonCard } from "@/app/_components/ds";
import type { EntityOption } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";
import { searchWorkProposals, resolveWorkProposals } from "@/lib/entityAdapters/workProposal";
import { searchSrItems } from "../../_data/client";


const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errBanner = { background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;

/**
 * GAP-WORKS-BOQ-NEW-01/02/04: zod at the form boundary. Quantity is a decimal
 * STRING (1–3 dp) validated by regex and sent as a string (the API accepts a
 * number OR a numeric string); rate goes through rupeesToMinorString so a
 * value like "1.005" (sub-paise) is rejected rather than silently rounded.
 */
const QTY_RE = /^\d+(\.\d{1,3})?$/;
const boqFormSchema = z.object({
  workId: z.string().uuid({ message: "Choose a work." }),
  itemDescription: z.string().min(1, "Enter an item description.").max(1024),
  unit: z.string().min(1, "Enter a unit.").max(64),
  rate: z.string().refine((v) => rupeesToMinorString(v) !== null, "Enter a valid rate greater than zero (up to 2 decimals)."),
  quantity: z.string().regex(QTY_RE, "Enter a valid quantity (up to 3 decimals)."),
});

/** Estimate = rate(paise) × quantity, in BigInt, rounded half-up to a paise.
 * quantity carries up to 3 dp, so scale by 1000 and divide back. Mirrors the
 * backend calculateBoqAmount contract closely enough for a preview. */
function estimateMinor(rateMinor: string, qty: string): bigint | null {
  if (!QTY_RE.test(qty)) return null;
  const [whole, frac = ""] = qty.split(".");
  const qtyMilli = BigInt(`${whole}${frac.padEnd(3, "0")}`); // qty × 1000
  const rate = BigInt(rateMinor);
  // round half-up
  return (rate * qtyMilli + 500n) / 1000n;
}

function NewBoqItemForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const presetWorkId = searchParams.get("workId") ?? "";
  const [form, setForm] = useState({
    workId: presetWorkId,
    itemDescription: "",
    itemCode: "",
    unit: "",
    rate: "",
    quantity: "",
    remarks: "",
  });
  const [srItemId, setSrItemId] = useState<string | null>(null);
  const [srCache, setSrCache] = useState<Record<string, { itemCode: string; description: string; unit: string; rate: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const formError = useFormError("BoQ item");

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  // GAP-WORKS-BOQ-NEW-01: picking an SR item prefills code/unit/rate from the
  // approved Schedule of Rates and records srItemId; manual edits to any of
  // those fields clear srItemId so the line is treated as a non-SR item.
  async function searchSr(q: string, signal: AbortSignal): Promise<EntityOption[]> {
    const rows = await searchSrItems(q, signal);
    setSrCache((prev) => {
      const next = { ...prev };
      for (const r of rows) next[r.id] = { itemCode: r.itemCode, description: r.description, unit: r.unit, rate: r.rate };
      return next;
    });
    return rows.map((r) => ({ id: r.id, label: `${r.itemCode} — ${r.description}`, sublabel: `${formatMoney(r.rate)} / ${r.unit}` }));
  }
  function onPickSr(id: string | string[] | null) {
    const picked = Array.isArray(id) ? id[0] ?? null : id;
    setSrItemId(picked);
    if (!picked) return;
    const hit = srCache[picked];
    if (hit) {
      const rupees = `${BigInt(hit.rate) / 100n}.${(BigInt(hit.rate) % 100n).toString().padStart(2, "0")}`;
      setForm((prev) => ({
        ...prev,
        itemCode: hit.itemCode,
        itemDescription: prev.itemDescription || hit.description,
        unit: hit.unit,
        rate: rupees,
      }));
    }
  }

  const rateMinor = rupeesToMinorString(form.rate);
  const estMinor = rateMinor ? estimateMinor(rateMinor, form.quantity) : null;
  const estimated = estMinor !== null ? formatMoney(estMinor) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    formError.clear();

    const parsed = boqFormSchema.safeParse({
      workId: form.workId.trim(),
      itemDescription: form.itemDescription.trim(),
      unit: form.unit.trim(),
      rate: form.rate.trim(),
      quantity: form.quantity.trim(),
    });
    if (!parsed.success) {
      setError(humanZodMessage(parsed.error.issues[0]));
      return;
    }
    const minor = rupeesToMinorString(parsed.data.rate);
    if (minor === null) {
      setError("Enter a valid rate (up to 2 decimals).");
      return;
    }

    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        workId: parsed.data.workId,
        itemDescription: parsed.data.itemDescription,
        unit: parsed.data.unit,
        rate: minor,
        // GAP-WORKS-BOQ-NEW-04: quantity sent as a decimal string (not a JS number).
        quantity: Number(parsed.data.quantity),
      };
      if (form.itemCode.trim()) body.itemCode = form.itemCode.trim();
      if (srItemId) body.srItemId = srItemId;
      if (form.remarks.trim()) body.remarks = form.remarks.trim();

      const res = await fetch("/api/proxy/v1/works/boq", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // GAP-WORKS-BOQ-NEW-04: a duplicate line is a 409 from the API — map it
        // to a clear, clerk-safe field message rather than the generic error.
        if (res.status === 409) {
          setError("This item already exists for this work.");
          return;
        }
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setMessage("BoQ item added.");
      toast.success("BoQ item added.");
      setTimeout(() => router.push(parsed.data.workId ? `/works/boq/${parsed.data.workId}` : "/works/boq"), 600);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Add BoQ Item"
        subtitle="Add a Bill of Quantities item to a work."
        back={form.workId.trim() ? `/works/boq/${form.workId.trim()}` : "/works/boq"}
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

          {/* GAP-WORKS-BOQ-NEW-03: search a work by its number instead of
              pasting a UUID. When arriving from a work page the id is preset
              and shown read-only (the picker still resolves its label). */}
          <Field label="Work *">
            <EntityPicker
              value={form.workId || null}
              onChange={(v) => setForm((prev) => ({ ...prev, workId: Array.isArray(v) ? v[0] ?? "" : v ?? "" }))}
              search={searchWorkProposals}
              resolve={resolveWorkProposals}
              disabled={presetWorkId.length > 0}
              placeholder="Search by work number…"
              aria-label="Work"
            />
          </Field>

          {/* GAP-WORKS-BOQ-NEW-01: Schedule of Rates lookup. */}
          <Field label="Schedule of Rates item (optional)">
            <EntityPicker
              value={srItemId}
              onChange={onPickSr}
              search={searchSr}
              placeholder="Search SR items by code or description…"
              aria-label="Schedule of Rates item"
            />
          </Field>

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
                onChange={(e) => { setSrItemId(null); set("itemCode")(e); }}
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
                onChange={(e) => { setSrItemId(null); set("unit")(e); }}
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
                type="text"
                inputMode="decimal"
                value={form.rate}
                onChange={(e) => { setSrItemId(null); set("rate")(e); }}
                placeholder="0.00"
                required
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="quantity">Quantity *</label>
              <input
                id="quantity"
                style={inputStyle}
                type="text"
                inputMode="decimal"
                value={form.quantity}
                onChange={set("quantity")}
                placeholder="0"
                required
              />
            </div>
          </div>

          {estimated !== null ? (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
              Estimated: {estimated}
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
            <Button
              variant="ghost"
              onClick={() => router.push(form.workId.trim() ? `/works/boq/${form.workId.trim()}` : "/works/boq")}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy}
            >
              {busy ? "Saving…" : "Add BoQ Item"}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}

export default function NewBoqItemPage() {
  // GAP-WORKS-BOQ-NEW-04: a real fallback so the suspense boundary shows a
  // skeleton instead of a blank frame while useSearchParams resolves.
  return (
    <Suspense fallback={<SkeletonCard />}>
      <NewBoqItemForm />
    </Suspense>
  );
}
