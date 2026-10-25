"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useRef, Suspense } from "react";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { humanZodMessage } from "@/lib/humanZodMessage";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader, Button, Field, EntityPicker, SkeletonCard } from "@/app/_components/ds";
import type { EntityOption } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { errorCodeFromResponse } from "@/lib/api/browserClient";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";
import { searchWorkProposals, resolveWorkProposals } from "@/lib/entityAdapters/workProposal";
import { searchSrItems } from "../../_data/client";


const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errBanner = { background: "var(--badbg)", color: "var(--bad)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "var(--goodbg)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;

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

/**
 * GAP-WORKS-BOQ-NEW-04 / BR-016: the key works-service compares to decide a BoQ line is a duplicate -- the item code
 * when there is one, otherwise the description, trimmed and case-insensitive. Kept in step with boqLineKey in
 * services/works-service/src/modules/boq/domain.ts so the early check on blur agrees with the server's answer.
 */
type BoqLineRef = { itemCode?: string | null; itemDescription?: string | null };
function boqLineKey(code: string | null | undefined, description: string | null | undefined): string {
  const c = (code ?? "").trim();
  return (c || (description ?? "").trim()).toLowerCase();
}
function isDuplicateLine(existing: BoqLineRef[], code: string, description: string): boolean {
  const key = boqLineKey(code, description);
  return key !== "" && existing.some((r) => boqLineKey(r.itemCode, r.itemDescription) === key);
}

type DuplicateError = { field: "itemCode" | "itemDescription"; message: string };

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
  const t = useTranslations("works.boqNew");
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
  // CLOS3-S3-18: latches so a second submit during the post-save redirect delay cannot create a duplicate item.
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const formError = useFormError("BoQ item");
  // The inline "this line already exists" error, bound to the field that identifies the line (item code when given,
  // else the description). The page-level banner stays for every other failure.
  const [dupError, setDupError] = useState<DuplicateError | null>(null);
  // The work's current BoQ lines, loaded lazily (first blur of the code/description) for the early duplicate check.
  const existingLines = useRef<{ workId: string; lines: BoqLineRef[] } | null>(null);

  function duplicateError(code: string): DuplicateError {
    return code.trim()
      ? { field: "itemCode", message: t("duplicateByCode") }
      : { field: "itemDescription", message: t("duplicateByDescription") };
  }

  /** Early (optional) check against the work's BoQ list. Silent on any failure: the server is the authority. */
  async function checkDuplicateEarly() {
    const workId = form.workId.trim();
    if (!z.string().uuid().safeParse(workId).success) return;
    if (!boqLineKey(form.itemCode, form.itemDescription)) return;
    try {
      let known = existingLines.current;
      if (!known || known.workId !== workId) {
        const res = await fetch(`/api/proxy/v1/works/boq/${workId}`);
        if (!res.ok) return;
        const body = (await res.json()) as { data?: unknown };
        known = { workId, lines: Array.isArray(body.data) ? (body.data as BoqLineRef[]) : [] };
        existingLines.current = known;
      }
      if (isDuplicateLine(known.lines, form.itemCode, form.itemDescription)) {
        setDupError(duplicateError(form.itemCode));
      }
    } catch {
      /* no early hint; the POST will still be refused with a 409 */
    }
  }

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
    if (inFlight.current || saved) return;
    setMessage("");
    setError("");
    setDupError(null);
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

    inFlight.current = true;
    setBusy(true);
    let ok = false;
    try {
      const body: Record<string, unknown> = {
        workId: parsed.data.workId,
        itemDescription: parsed.data.itemDescription,
        unit: parsed.data.unit,
        rate: minor,
        // GAP-WORKS-BOQ-NEW-04: quantity sent as a decimal string (not a JS number); works-service normalises it.
        quantity: parsed.data.quantity,
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
        // GAP-WORKS-BOQ-NEW-04: a duplicate line is a synchronous 409 DUPLICATE_BOQ_LINE from works-service (flat
        // envelope, code at the top level) -- shown on the field that identifies the line, with the form kept. Any
        // other failure (a frozen BoQ is also a 409) takes the catalogued page-level message.
        if (res.status === 409 && (await errorCodeFromResponse(res)) === "DUPLICATE_BOQ_LINE") {
          setDupError(duplicateError(form.itemCode));
          return;
        }
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      ok = true;
      setSaved(true);
      setMessage("BoQ item added.");
      toast.success("BoQ item added.");
      setTimeout(() => router.push(parsed.data.workId ? `/works/boq/${parsed.data.workId}` : "/works/boq"), 600);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      inFlight.current = false;
      if (!ok) setBusy(false);
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
              onChange={(e) => { setDupError(null); set("itemDescription")(e); }}
              onBlur={() => { void checkDuplicateEarly(); }}
              maxLength={1024}
              required
              aria-invalid={dupError?.field === "itemDescription" ? true : undefined}
              aria-describedby={dupError?.field === "itemDescription" ? "itemDescription-error" : undefined}
            />
            {dupError?.field === "itemDescription" ? (
              <p id="itemDescription-error" role="alert" style={{ fontSize: 12, color: "var(--bad)", marginTop: 4 }}>
                {dupError.message}
              </p>
            ) : null}
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
                onChange={(e) => { setSrItemId(null); setDupError(null); set("itemCode")(e); }}
                onBlur={() => { void checkDuplicateEarly(); }}
                placeholder="e.g. SR-2024-C001"
                maxLength={64}
                aria-invalid={dupError?.field === "itemCode" ? true : undefined}
                aria-describedby={dupError?.field === "itemCode" ? "itemCode-error" : undefined}
              />
              {dupError?.field === "itemCode" ? (
                <p id="itemCode-error" role="alert" style={{ fontSize: 12, color: "var(--bad)", marginTop: 4 }}>
                  {dupError.message}
                </p>
              ) : null}
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
              disabled={busy || saved}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || saved}
            >
              {busy || saved ? "Saving…" : "Add BoQ Item"}
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
