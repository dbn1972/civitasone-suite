'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LineItemsEditor, emptyLineItem, lineItemsTotalMinor, type LineItem } from "../../_components/LineItemsEditor";
import { trackActivation } from "@/lib/activation";
import { useFormError } from "@/lib/useFormError";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { Button } from "@/app/_components/ds";

type GfrBand = { id: string; name: string; notes: string; requiresTender: boolean };
type ModeState = "idle" | "loading" | "ready" | "error";

export function CreateIndentForm({
  initialItem = null,
  prefillTruncated = false,
}: { initialItem?: LineItem | null; prefillTruncated?: boolean } = {}) {
  const router = useRouter();

  // GAP-PROCUREMENT-INDENTS-NEW-04: no browser-generated indent number. The
  // server allocates a gapless per-tenant number on submit; the field is a
  // read-only placeholder until then.
  const [department, setDepartment] = useState(""); // NEW-01: must be chosen, not pre-filled "Finance"
  const [indentDate, setIndentDate] = useState(new Date().toISOString().slice(0, 10));
  const [requiredBy, setRequiredBy] = useState("");
  const [purpose, setPurpose] = useState("");
  const [items, setItems] = useState<LineItem[]>([initialItem ?? emptyLineItem()]);
  const [modeBand, setModeBand] = useState<GfrBand | null>(null);
  const [modeState, setModeState] = useState<ModeState>("idle");
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  /** Client-authored copy for pre-submit validation and success — never server text. */
  const [message, setMessage] = useState("");
  // NEW-05: per-field client errors (mirrors the server's own validation).
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formError = useFormError("indent");
  // Lines with no unit price feed the estimated value and the procurement-mode band, so the
  // first submit asks for confirmation (never blocks); editing any line resets it.
  const [zeroPriceAck, setZeroPriceAck] = useState(false);
  useEffect(() => { setZeroPriceAck(false); }, [items]);

  // GAP-PROCUREMENT-INDENTS-NEW-02: the estimated value that drives the GFR
  // mode band is DERIVED from the line items, so the band can never disagree
  // with the actual total a second, independently-typed header field used to
  // allow.
  const estimatedValueMinor = lineItemsTotalMinor(items);

  // GAP-PROCUREMENT-INDENTS-NEW-03: a lookup state machine so a failed check is
  // not shown as perpetual "Determining mode…". Reruns on retry via `nonce`.
  const [lookupNonce, setLookupNonce] = useState(0);
  const retryLookup = useCallback(() => setLookupNonce((n) => n + 1), []);

  useEffect(() => {
    if (estimatedValueMinor <= 0) { setModeBand(null); setModeState("idle"); return; }
    let cancelled = false;
    setModeState("loading");
    fetch("/api/proxy/v1/procurement/gfr/mode-bands?estimatedValueMinor=" + estimatedValueMinor)
      .then((r) => {
        if (!r.ok) throw new Error(`mode-bands lookup failed: ${r.status}`);
        return r.json() as Promise<{ data: GfrBand[]; applicableMode?: string }>;
      })
      .then((json) => {
        if (cancelled) return;
        const id = json.applicableMode;
        const band = id ? (json.data.find((b) => b.id === id) ?? null) : null;
        setModeBand(band);
        setModeState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setModeBand(null);
        setModeState("error");
      });
    return () => { cancelled = true; };
  }, [estimatedValueMinor, lookupNonce]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter((it) => it.itemCode.trim() && it.description.trim());

    // NEW-05: per-field validation (mirrors server createIndentBody).
    const fe: Record<string, string> = {};
    if (!department.trim()) fe.department = "Choose the department raising this indent.";
    if (purpose.trim().length < 3) fe.purpose = "Enter a purpose of at least 3 characters.";
    if (validItems.length === 0) fe.items = "Add at least one line item with a code and description.";
    if (requiredBy && indentDate && requiredBy < indentDate) {
      fe.requiredBy = "Required-by date cannot be before the indent date.";
    }
    if (Object.keys(fe).length > 0) {
      setFieldErrors(fe);
      setStatus("error");
      setMessage("Please correct the highlighted fields.");
      return;
    }
    setFieldErrors({});

    const unpriced = validItems.filter((it) => !(it.unitPrice > 0)).length;
    if (unpriced > 0 && !zeroPriceAck) {
      setZeroPriceAck(true);
      setStatus("error");
      setMessage(
        `${unpriced} line item${unpriced === 1 ? " has" : "s have"} no unit price, so the estimated value and procurement mode may be wrong. ` +
        "Enter a price, or press Submit for approval again to continue without it.",
      );
      return;
    }
    setStatus("submitting"); setMessage(""); formError.clear();
    const body = {
      // NEW-04: no client indentNo — the server allocates a gapless number.
      department: department.trim(),
      purpose: purpose.trim(),
      indentDate: indentDate || new Date().toISOString().slice(0, 10),
      requiredBy: requiredBy || undefined,
      estimatedValueMinor: estimatedValueMinor > 0 ? estimatedValueMinor : undefined,
      items: validItems.map((it) => ({
        itemCode: it.itemCode.trim(),
        description: it.description.trim(),
        quantity: Math.max(1, it.quantity),
        unit: it.unit, // NEW-04: the clerk-chosen unit, not a hard-coded "nos"
        unitPriceMinor: Math.max(0, Math.round(it.unitPrice * 100)),
      })),
    };
    try {
      const res = await fetch("/api/proxy/v1/procurement/indents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setStatus("error");
        await formError.fromResponse(res, "save");
        return;
      }
      setStatus("accepted");
      trackActivation("first_transaction");
      setMessage("Indent submitted for approval via workflow. Its number is assigned on submit.");
      router.push("/procurement/indents");
      router.refresh();
    } catch (caught) {
      setStatus("error"); formError.fromException("save", caught);
    }
  }

  const deptError = fieldErrors.department ?? formError.fieldError("department");
  const purposeError = fieldErrors.purpose ?? formError.fieldError("purpose");

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 860 }} noValidate>
      <div className="fields">
        {/* Indent No — assigned by the server on submit (NEW-04) */}
        <div className="field" style={{ background: "var(--panel)", padding: "13px 16px" }}>
          <label className="label" htmlFor="indentNo">Indent No</label>
          <input id="indentNo" className="inp mono" value="Assigned on submit" readOnly style={{ minHeight: 44, cursor: "default", background: "var(--panel)", color: "var(--mut)" }} />
        </div>

        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="indentDate">Indent date *</label>
          <input id="indentDate" type="date" className="inp" value={indentDate} onChange={(e) => setIndentDate(e.target.value)} required style={{ minHeight: 44 }} />
        </div>

        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="department">Department *</label>
          <input
            id="department"
            className="inp"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            required
            placeholder="Enter the requesting department"
            aria-invalid={deptError ? true : undefined}
            aria-describedby={deptError ? "department-err" : undefined}
            style={{ minHeight: 44 }}
          />
          {deptError && (
            <span id="department-err" style={{ fontSize: 12, color: "var(--bad)" }}>{deptError}</span>
          )}
        </div>

        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="requiredBy">Required by date</label>
          <input
            id="requiredBy"
            type="date"
            className="inp"
            value={requiredBy}
            min={indentDate || undefined}
            onChange={(e) => setRequiredBy(e.target.value)}
            aria-invalid={fieldErrors.requiredBy ? true : undefined}
            aria-describedby={fieldErrors.requiredBy ? "requiredBy-err" : undefined}
            style={{ minHeight: 44 }}
          />
          {fieldErrors.requiredBy && (
            <span id="requiredBy-err" style={{ fontSize: 12, color: "var(--bad)" }}>{fieldErrors.requiredBy}</span>
          )}
        </div>

        {/* GAP-PROCUREMENT-INDENTS-NEW-02: estimated value is DERIVED (read-only)
            from the line items and drives the GFR mode band — no second,
            independently-typed figure that could select the wrong band. */}
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <span className="label">
            Estimated total value (from line items)
            <span style={{ fontSize: 11, color: "var(--ink2)", marginInlineStart: 4 }}>— determines procurement mode</span>
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
            <span className="mono" aria-live="polite" style={{ fontWeight: 600 }}>{formatMoney(estimatedValueMinor)}</span>
            {modeState === "ready" && modeBand ? (
              <>
                <span style={{ background: modeBand.requiresTender ? "var(--warn)" : "var(--good)", color: "#fff", borderRadius: 3, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>
                  {modeBand.id}
                </span>
                <span style={{ fontSize: 12, color: "var(--ink2)" }}>{modeBand.name} — {modeBand.notes}</span>
              </>
            ) : modeState === "loading" ? (
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>Determining mode…</span>
            ) : modeState === "error" ? (
              // GAP-PROCUREMENT-INDENTS-NEW-03: a failed check is explicit, not
              // a perpetual "Determining mode…" that hides a missing tender
              // requirement.
              <span role="alert" style={{ fontSize: 12, color: "var(--bad)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                {toHumanError("load", { area: "procurement mode" }).what} The tender-requirement check did not run.
                <Button type="button" variant="ghost" size="sm" onClick={retryLookup}>Retry</Button>
              </span>
            ) : null}
          </div>
        </div>

        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="purpose">Purpose / justification *</label>
          <textarea
            id="purpose"
            className="inp"
            rows={2}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            required
            minLength={3}
            maxLength={500}
            placeholder="Why this purchase is needed (minimum 3 characters)"
            aria-invalid={purposeError ? true : undefined}
            aria-describedby={purposeError ? "purpose-err" : undefined}
          />
          {purposeError && (
            <span id="purpose-err" style={{ fontSize: 12, color: "var(--bad)" }}>{purposeError}</span>
          )}
        </div>
      </div>

      {prefillTruncated ? (
        <p role="note" style={{ fontSize: 13, color: "#92400e", margin: "0 0 8px" }}>
          The item description was too long and has been shortened. Check it before submitting.
        </p>
      ) : null}
      <LineItemsEditor items={items} onChange={setItems} />
      {fieldErrors.items && (
        <p role="alert" style={{ fontSize: 12, color: "var(--bad)", marginTop: 6 }}>{fieldErrors.items}</p>
      )}

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, color: status === "error" ? "var(--bad)" : "var(--good)", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
        {formError.message ? (
          <p role="alert" style={{ marginTop: 12, color: "var(--bad)", fontSize: "0.875rem" }}>
            {formError.message}
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : "Submit for approval"}
        </Button>
        <Link href="/procurement/indents" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
