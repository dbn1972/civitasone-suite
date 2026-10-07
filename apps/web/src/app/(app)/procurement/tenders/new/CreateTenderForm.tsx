"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString, nonNegativeRupeesToMinorString } from "@/lib/money";
import { todayIST } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";
import { Button } from "@/app/_components/ds";

const TYPES = [
  { value: "open", label: "Open" },
  { value: "limited", label: "Limited" },
  { value: "single_source", label: "Single Source" },
  { value: "gem", label: "GeM" },
] as const;

type IndentOption = { id: string; indentNo?: string; department?: string; status?: string };
type GfrBand = { id: string; name: string; notes: string; requiresTender: boolean };

const JUSTIFICATION_CATEGORIES = [
  { value: "proprietary", label: "Proprietary item (single manufacturer)" },
  { value: "emergency", label: "Emergency / urgency" },
  { value: "standardisation", label: "Standardisation / compatibility" },
  { value: "other", label: "Other (GFR Rule 166)" },
] as const;

const MAX_TEXT = 4000;

export function CreateTenderForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("open");
  const [scope, setScope] = useState("");
  const [eligibility, setEligibility] = useState("");
  // Money typed as strings so we can convert with the shared, float-free helper.
  const [estimated, setEstimated] = useState("");
  const [emd, setEmd] = useState("");
  const [emdExempt, setEmdExempt] = useState(false);
  const [emdExemptReason, setEmdExemptReason] = useState("");
  const [bidClosingDate, setBidClosingDate] = useState("");
  const [openingDate, setOpeningDate] = useState("");
  // GAP-PROCUREMENT-TENDERS-NEW-01: source indent link.
  const [indents, setIndents] = useState<IndentOption[]>([]);
  const [indentId, setIndentId] = useState("");
  // GAP-PROCUREMENT-TENDERS-NEW-02: single-source justification.
  const [justificationCategory, setJustificationCategory] = useState("");
  const [justification, setJustification] = useState("");
  const [approvingAuthority, setApprovingAuthority] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");
  const [band, setBand] = useState<GfrBand | null>(null);
  const formError = useFormError("tender");

  const today = todayIST();
  const estimatedMinor = rupeesToMinorString(estimated, { allowZero: true });
  const estimatedMinorNum = estimatedMinor != null ? Number(estimatedMinor) : 0;

  // GAP-PROCUREMENT-TENDERS-NEW-01: approved indents to link against.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/proxy/v1/procurement/indents?status=approved&limit=100", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j: { data?: IndentOption[] }) => setIndents(Array.isArray(j.data) ? j.data : []))
      .catch(() => { /* leave empty; field stays usable, submit still validates */ });
    return () => controller.abort();
  }, []);

  // GAP-PROCUREMENT-TENDERS-NEW-01: GFR mode band for the estimated value, so a
  // mode outside the band can be flagged before the server 422s.
  useEffect(() => {
    if (estimatedMinorNum <= 0) { setBand(null); return; }
    const controller = new AbortController();
    fetch(`/api/proxy/v1/procurement/gfr/mode-bands?estimatedValueMinor=${estimatedMinorNum}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { data: [], applicableMode: undefined }))
      .then((j: { data?: GfrBand[]; applicableMode?: string }) => {
        const b = j.applicableMode ? (j.data?.find((x) => x.id === j.applicableMode) ?? null) : null;
        setBand(b);
      })
      .catch(() => setBand(null));
    return () => controller.abort();
  }, [estimatedMinorNum]);

  // The band is advisory in the UI; the server enforces the floor (open>limited>
  // direct) via assertModeAllowedForValue. We flag a lower-rigour choice.
  const RIGOUR: Record<string, number> = { gem: -1, single_source: -1, limited: 1, open: 2 };
  const bandRigour = useMemo(() => {
    if (!band) return 0;
    if (band.id === "DP" || band.id === "LS") return 0;
    if (band.id === "LTR" || band.id === "LTE") return 1;
    return 2; // OT / GT
  }, [band]);
  const modeBelowBand = band != null && type !== "gem" && type !== "single_source" && RIGOUR[type] < bandRigour;

  const emdMinor = emdExempt ? "0" : (emd.trim() ? nonNegativeRupeesToMinorString(emd) : "0");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // GAP-PROCUREMENT-TENDERS-NEW-01/03: client validation mirroring the server.
    if (title.trim().length < 1) { setStatus("error"); setMessage("Tender title is required."); return; }
    if (!indentId) { setStatus("error"); setMessage("Choose the source indent this tender is raised against."); return; }
    if (estimatedMinor == null || Number(estimatedMinor) <= 0) {
      setStatus("error"); setMessage("Enter an estimated value greater than ₹0."); return;
    }
    if (!bidClosingDate) { setStatus("error"); setMessage("Bid closing date is required."); return; }
    if (bidClosingDate < today) { setStatus("error"); setMessage("Bid closing date cannot be in the past."); return; }
    if (openingDate && openingDate < bidClosingDate) {
      setStatus("error"); setMessage("Opening date cannot be before the bid closing date."); return;
    }
    if (emdExempt && emdExemptReason.trim().length < 3) {
      setStatus("error"); setMessage("Give a reason for the EMD exemption (e.g. MSE/Startup)."); return;
    }
    if (!emdExempt && emd.trim() && emdMinor == null) {
      setStatus("error"); setMessage("EMD amount is not a valid rupee value."); return;
    }
    // GAP-PROCUREMENT-TENDERS-NEW-02: single-source justification required.
    if (type === "single_source") {
      if (!justificationCategory) { setStatus("error"); setMessage("Select a justification category for single-source procurement."); return; }
      if (justification.trim().length < 10) { setStatus("error"); setMessage("Enter a single-source justification of at least 10 characters."); return; }
      if (!approvingAuthority.trim()) { setStatus("error"); setMessage("Name the approving authority for single-source procurement."); return; }
    }

    setStatus("submitting");
    setMessage("");
    const body = {
      title: title.trim(),
      type,
      scope: scope.trim() || undefined,
      eligibility: eligibility.trim() || undefined,
      estimatedMinor: Number(estimatedMinor),
      emdAmountMinor: Number(emdMinor ?? "0"),
      bidClosingDate,
      openingDate: openingDate || undefined,
      indentRef: `procurement_indent:${indentId}`,
      ...(type === "single_source"
        ? {
            justificationCategory,
            justification: justification.trim(),
            approvingAuthority: approvingAuthority.trim(),
          }
        : {}),
    };
    try {
      const res = await fetch("/api/proxy/v1/procurement/tenders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      const parsed = (await res.json()) as { id?: string };
      setStatus("accepted");
      // GAP-PROCUREMENT-TENDERS-NEW-04: honest copy — this is only a draft.
      setMessage("Tender saved as draft. Next: attach the NIT and publish.");
      router.push(parsed.id ? `/procurement/tenders/${parsed.id}/documents` : "/procurement/tenders");
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  const fieldStyle: React.CSSProperties = { background: "var(--panel)", padding: "13px 16px" };

  return (
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 760 }} noValidate>
      <div className="fields">
        <div className="field" style={{ gridColumn: "1 / -1", ...fieldStyle }}>
          <label className="label" htmlFor="t-title">Tender title *</label>
          <input id="t-title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} style={{ minHeight: 44 }} />
        </div>

        {/* GAP-PROCUREMENT-TENDERS-NEW-01: source indent link. */}
        <label className="field" style={fieldStyle}>
          <span className="label">Source indent *</span>
          <select value={indentId} onChange={(e) => setIndentId(e.target.value)} required style={{ minHeight: 44 }}>
            <option value="">Select an approved indent…</option>
            {indents.map((i) => (
              <option key={i.id} value={i.id}>{i.indentNo ?? i.id}{i.department ? ` — ${i.department}` : ""}</option>
            ))}
          </select>
        </label>

        <label className="field" style={fieldStyle}>
          <span className="label">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} style={{ minHeight: 44 }}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>

        <div className="field" style={fieldStyle}>
          <label className="label" htmlFor="t-est">Estimated value (₹) *</label>
          <input id="t-est" type="text" inputMode="decimal" className="inp" value={estimated} onChange={(e) => setEstimated(e.target.value)} style={{ minHeight: 44 }} />
          <span style={{ fontSize: 12, color: "var(--mut)", marginTop: 4 }} aria-live="polite">
            {estimatedMinor != null ? formatMoney(estimatedMinor) : "Enter a valid rupee amount"}
            {band ? ` · GFR mode: ${band.id} (${band.name})` : ""}
          </span>
          {modeBelowBand ? (
            <span role="alert" style={{ fontSize: 12, color: "var(--bad)", marginTop: 4 }}>
              This value typically requires {band?.name}. {TYPES.find((t) => t.value === type)?.label} is below the GFR band and will be rejected.
            </span>
          ) : null}
        </div>

        <label className="field" style={fieldStyle}>
          <span className="label">Bid closing date *</span>
          <input type="date" value={bidClosingDate} min={today} onChange={(e) => setBidClosingDate(e.target.value)} required style={{ minHeight: 44 }} />
        </label>

        {/* GAP-PROCUREMENT-TENDERS-NEW-04: optional opening date. */}
        <label className="field" style={fieldStyle}>
          <span className="label">Bid opening date</span>
          <input type="date" value={openingDate} min={bidClosingDate || today} onChange={(e) => setOpeningDate(e.target.value)} style={{ minHeight: 44 }} />
        </label>

        <div className="field" style={fieldStyle}>
          <label className="label" htmlFor="t-emd">EMD amount (₹)</label>
          <input id="t-emd" type="text" inputMode="decimal" className="inp" value={emd} disabled={emdExempt} onChange={(e) => setEmd(e.target.value)} style={{ minHeight: 44 }} />
          <span style={{ fontSize: 12, color: "var(--mut)", marginTop: 4 }} aria-live="polite">
            {emdExempt ? "Exempt — ₹0" : (emd.trim() ? formatMoney(emdMinor ?? "0") : "Typically 2–5% of the estimated value")}
          </span>
          {/* GAP-PROCUREMENT-TENDERS-NEW-03: EMD exemption (MSE/Startup). */}
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginTop: 6 }}>
            <input type="checkbox" checked={emdExempt} onChange={(e) => setEmdExempt(e.target.checked)} />
            EMD exempt (MSE / Startup)
          </label>
          {emdExempt ? (
            <input className="inp" placeholder="Exemption reason" value={emdExemptReason} onChange={(e) => setEmdExemptReason(e.target.value)} maxLength={200} style={{ minHeight: 40, marginTop: 6 }} />
          ) : null}
        </div>

        {/* GAP-PROCUREMENT-TENDERS-NEW-02: single-source justification. */}
        {type === "single_source" ? (
          <div className="field" style={{ gridColumn: "1 / -1", ...fieldStyle, borderInlineStart: "3px solid var(--warn)" }}>
            <span className="label">Single-source justification (GFR Rule 166) *</span>
            <select value={justificationCategory} onChange={(e) => setJustificationCategory(e.target.value)} style={{ minHeight: 44, marginBottom: 8 }}>
              <option value="">Select a category…</option>
              {JUSTIFICATION_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <textarea className="inp" rows={2} placeholder="Reason this must be single-source (min 10 characters)" value={justification} maxLength={2000} onChange={(e) => setJustification(e.target.value)} />
            <input className="inp" placeholder="Approving authority" value={approvingAuthority} maxLength={200} onChange={(e) => setApprovingAuthority(e.target.value)} style={{ minHeight: 44, marginTop: 8 }} />
          </div>
        ) : null}

        <div className="field" style={{ gridColumn: "1 / -1", ...fieldStyle }}>
          <label className="label" htmlFor="t-scope">Scope of work</label>
          <textarea id="t-scope" className="inp" rows={3} value={scope} maxLength={MAX_TEXT} onChange={(e) => setScope(e.target.value)} />
          <span style={{ fontSize: 11, color: "var(--mut)" }}>{scope.length}/{MAX_TEXT}</span>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1", ...fieldStyle }}>
          <label className="label" htmlFor="t-elig">Eligibility criteria</label>
          <textarea id="t-elig" className="inp" rows={3} value={eligibility} maxLength={MAX_TEXT} onChange={(e) => setEligibility(e.target.value)} />
          <span style={{ fontSize: 11, color: "var(--mut)" }}>{eligibility.length}/{MAX_TEXT}</span>
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "var(--bad)" : "var(--good)" }}>{message}</p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Saving…" : "Save tender"}
        </Button>
        <Link href="/procurement/tenders" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
