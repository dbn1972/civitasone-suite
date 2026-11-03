"use client";

/**
 * UAT P2 (J7): create a budget allocation for a head and financial year on screen, through the existing
 * finance-service command POST /v1/finance/budget-allocations ({ headId, fy, allocatedMinor }). The amount is
 * converted rupees -> paise as a string (never a float). Every check shows a written message next to the field
 * (not only the browser's native tooltip), and nothing is sent until the officer confirms.
 */
import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Alert, Button, ConfirmDialog, EntityPicker, Field, type EntityOption } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";
import { currentFinancialYear, isValidFinancialYearLabel } from "@/lib/fiscalYear";
import { budgetableHeads, headOptionLabel, type AccountRow } from "../../_lib/heads";

const HEADS_LIMIT = 50;
const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

type Errors = { head?: string; fy?: string; amount?: string };

export function NewAllocationForm() {
  const t = useTranslations("budgetAllocationNew");
  const formError = useFormError("budget allocation");
  const knownHeads = useRef<Map<string, EntityOption>>(new Map());
  const [headId, setHeadId] = useState("");
  const [fy, setFy] = useState(() => currentFinancialYear());
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [confirmMinor, setConfirmMinor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const rotateKey = () => setIdempotencyKey(crypto.randomUUID());
  const previewMinor = rupeesToMinorString(amount);

  const searchHeads = useCallback(async (q: string, signal: AbortSignal): Promise<EntityOption[]> => {
    try {
      const res = await fetch(`/api/proxy/v1/finance/accounts?limit=${HEADS_LIMIT}&q=${encodeURIComponent(q)}`, {
        headers: { accept: "application/json" },
        signal,
      });
      if (!res.ok) {
        setLoadError((await formError.fromResponse(res, "load")).message);
        return [];
      }
      const json = (await res.json()) as { data?: AccountRow[] } | AccountRow[];
      const rows = Array.isArray(json) ? json : json.data ?? [];
      setLoadError("");
      const options = budgetableHeads(rows).map((a) => ({ id: a.id, label: headOptionLabel(a) }));
      for (const o of options) knownHeads.current.set(o.id, o);
      return options;
    } catch (err) {
      if (signal.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
      setLoadError(formError.fromException("load", err).message);
      return [];
    }
    // formError's methods are stable (see useFormError).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!headId) next.head = t("headRequired");
    if (!isValidFinancialYearLabel(fy)) next.fy = t("fyInvalid");
    const minor = rupeesToMinorString(amount);
    if (minor === null) next.amount = t("amountInvalid");
    setErrors(next);
    if (Object.keys(next).length > 0 || minor === null) return;
    setResult(null);
    setConfirmMinor(minor);
  }

  async function confirm() {
    const allocatedMinor = confirmMinor;
    if (allocatedMinor === null || busy) return;
    setBusy(true);
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/finance/budget-allocations", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
        body: JSON.stringify({ headId, fy, allocatedMinor }),
      });
      setConfirmMinor(null);
      if (!res.ok) {
        setResult({ ok: false, text: (await formError.fromResponse(res, "save")).message });
        return;
      }
      setResult({ ok: true, text: t("saved") });
      setAmount("");
      rotateKey();
    } catch (err) {
      setConfirmMinor(null);
      setResult({ ok: false, text: formError.fromException("save", err).message });
    } finally {
      setBusy(false);
    }
  }

  const headLabel = knownHeads.current.get(headId)?.label ?? t("selectedHead");

  return (
    <>
      {result ? (
        <Alert variant={result.ok ? "success" : "danger"} aria-live="polite">
          {result.text}
          {result.ok ? <> <Link href="/finance/budget/allocation">{t("viewList")}</Link></> : null}
        </Alert>
      ) : null}
      {loadError ? <Alert variant="danger" aria-live="assertive">{loadError}</Alert> : null}
      <div className="card">
        <form onSubmit={submit} className="pad" noValidate>
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <Field label={t("head")} required {...(errors.head || formError.fieldError("headId") ? { error: errors.head ?? formError.fieldError("headId") } : {})}>
                <EntityPicker
                  value={headId || null}
                  onChange={(v) => { setHeadId((Array.isArray(v) ? v[0] : v) ?? ""); setErrors((x) => ({ ...x, head: undefined })); rotateKey(); }}
                  search={searchHeads}
                  placeholder={t("headPlaceholder")}
                  searchingText={t("searching")}
                  noResultsText={t("noHeads")}
                />
              </Field>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="alloc-fy">{t("fy")}</label>
              <input id="alloc-fy" placeholder="YYYY-YY" value={fy} onChange={(e) => { setFy(e.target.value); setErrors((x) => ({ ...x, fy: undefined })); rotateKey(); }}
                aria-invalid={errors.fy ? true : undefined} aria-describedby={errors.fy ? "alloc-fy-err" : undefined} style={inputStyle} />
              {errors.fy ? <span id="alloc-fy-err" role="alert" style={{ fontSize: 12, color: "var(--bad)" }}>{errors.fy}</span> : null}
              {formError.fieldError("fy") ? <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("fy")}</span> : null}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="alloc-amt">{t("amount")}</label>
              <input id="alloc-amt" type="text" inputMode="decimal" autoComplete="off" value={amount}
                onChange={(e) => { setAmount(e.target.value); setErrors((x) => ({ ...x, amount: undefined })); rotateKey(); }}
                aria-invalid={errors.amount ? true : undefined} aria-describedby="alloc-amt-hint" style={inputStyle} />
              <span id="alloc-amt-hint" style={{ fontSize: 12, color: "var(--mut)" }}>
                {previewMinor !== null ? t("amountPreview", { amount: formatMoney(BigInt(previewMinor)) }) : t("amountHint")}
              </span>
              {errors.amount ? <span role="alert" style={{ fontSize: 12, color: "var(--bad)" }}>{errors.amount}</span> : null}
              {formError.fieldError("allocatedMinor") ? <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("allocatedMinor")}</span> : null}
            </div>
          </div>
          <p role="note" style={{ fontSize: 12, color: "var(--mut)", margin: "8px 0 0" }}>{t("replaceNote")}</p>
          <Button type="submit" disabled={busy} aria-busy={busy} style={{ marginTop: 12 }}>{t("submit")}</Button>
        </form>
      </div>
      <ConfirmDialog
        open={confirmMinor !== null}
        title={t("confirmTitle")}
        description={confirmMinor !== null ? t("confirmBody", { amount: formatMoney(BigInt(confirmMinor)), head: headLabel, fy }) : undefined}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        onConfirm={() => { void confirm(); }}
        onCancel={() => { if (!busy) setConfirmMinor(null); }}
      />
    </>
  );
}
