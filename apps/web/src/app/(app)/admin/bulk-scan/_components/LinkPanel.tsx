"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Select } from "@/app/_components/ds";
import { useBulkScanError, type BsError } from "@/lib/bulkScan/useBulkScanError";
import { formatReference } from "@/lib/errorCatalogue";
import { bsRequest, qs } from "@/lib/bulkScan/api";
import { mapLookup } from "@/lib/bulkScan/mappers";
import { isAmountMismatch, isFinanceTarget } from "@/lib/bulkScan/review";
import type { LinkSuggestion, LookupCandidate } from "@/lib/bulkScan/types";
import { formatMoney } from "@/lib/formatters";
import { parseRupeesToPaise } from "@/lib/money";
import { Chip, ConfidenceBadge } from "./Chips";

export interface ChosenLink { target: string; targetId: string; label: string }

function CandidateRow({ c, docAmountMinor, chosen, onChoose, disabled }: {
  c: LinkSuggestion | LookupCandidate; docAmountMinor: string | null; chosen: ChosenLink | null; onChoose: (c: ChosenLink) => void; disabled: boolean;
}) {
  const t = useTranslations("bulkScan");
  const mismatch = isAmountMismatch(c, docAmountMinor);
  const isChosen = chosen?.target === c.target && chosen.targetId === c.targetId;
  return (
    <li className="card" style={{ padding: 10, display: "grid", gap: 4, borderInlineStart: mismatch ? "4px solid var(--bad)" : undefined }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong>{c.label}</strong>
        <span style={{ fontSize: 12 }}>{t(`target.${c.target}`)}</span>
        {c.confidence !== null ? <ConfidenceBadge value={c.confidence} /> : null}
      </div>
      {c.reference ? <div style={{ fontSize: 13 }}>{t("link.reference")}: {c.reference}</div> : null}
      {isFinanceTarget(c.target) ? (
        <div style={{ fontSize: 13 }}>
          {t("link.amount")}: {formatMoney(c.amountMinor)}
          {docAmountMinor !== null ? ` · ${t("link.documentAmount")}: ${formatMoney(docAmountMinor)}` : ""}
        </div>
      ) : null}
      {mismatch ? (
        <p role="alert" style={{ margin: 0, color: "var(--bad)" }}><span aria-hidden="true">⚠ </span>{t("link.mismatch")}</p>
      ) : null}
      <div>
        {mismatch ? (
          <span style={{ fontSize: 13 }}>{t("link.cannotAttach")}</span>
        ) : (
          <Button size="sm" variant={isChosen ? "secondary" : "primary"} disabled={disabled} aria-pressed={isChosen}
            aria-label={t("link.chooseAria", { label: c.label })} onClick={() => onChoose({ target: c.target, targetId: c.targetId, label: c.label })}>
            {isChosen ? t("link.chosen") : t("link.choose")}
          </Button>
        )}
      </div>
    </li>
  );
}

export function LinkPanel({ suggestions, docAmountMinor, allowedTargets, chosen, onChoose, disabled }: {
  suggestions: LinkSuggestion[]; docAmountMinor: string | null; allowedTargets: readonly string[]; chosen: ChosenLink | null;
  onChoose: (c: ChosenLink | null) => void; disabled: boolean;
}) {
  const t = useTranslations("bulkScan");
  const describe = useBulkScanError();
  const plain = (key: string): BsError => ({ message: t(key), reference: null });
  const [target, setTarget] = useState(allowedTargets[0] ?? "hr_employee");
  const [q, setQ] = useState("");
  const [amount, setAmount] = useState("");
  const [results, setResults] = useState<LookupCandidate[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<BsError | null>(null);
  const [amountError, setAmountError] = useState(false);

  const finance = isFinanceTarget(target);
  const qHint = target === "hr_employee" ? t("link.qHr") : target === "eoffice_file" ? t("link.qEoffice") : t("link.qFinance");

  async function lookup(): Promise<void> {
    const query = q.trim();
    if (!query) { setError(plain("link.qRequired")); return; }
    let amountMinor: string | undefined;
    if (finance && amount.trim()) {
      const m = parseRupeesToPaise(amount);
      if (m === null) { setAmountError(true); return; }
      amountMinor = m;
    }
    setAmountError(false);
    setError(null);
    setLookupError(null);
    setLoading(true);
    const r = await bsRequest(`/link-lookup${qs({ target, q: query, amountMinor })}`);
    setLoading(false);
    if (!r.ok) { setError(describe(r, "load")); setResults(null); return; }
    const out = mapLookup(r.json);
    if (!out) { setError(plain("apiError.generic")); setResults(null); return; }
    // The target service being down still answers 200: say so instead of "no matching records".
    if (out.error) { setResults(null); setError(plain(out.error.code === "LOOKUP_NOT_CONFIGURED" ? "link.lookupNotConfigured" : "link.lookupUnavailable")); setLookupError(out.error.code); return; }
    setLookupError(null);
    setResults(out.items);
  }

  return (
    <section aria-labelledby="link-h" className="card" style={{ padding: 12 }}>
      <h3 id="link-h" style={{ margin: "0 0 8px" }}>{t("link.title")}</h3>
      <p style={{ fontSize: 13, margin: "0 0 8px" }}>{t("link.help")}</p>

      <div aria-live="polite" style={{ marginBottom: 8 }}>
        {chosen ? (
          <p style={{ margin: 0 }}>
            <Chip tone="info" icon="🔗">{t("link.chosenTarget", { target: t(`target.${chosen.target}`), label: chosen.label })}</Chip>{" "}
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChoose(null)}>{t("link.clear")}</Button>
          </p>
        ) : <p style={{ margin: 0, fontSize: 13 }}>{t("link.none")}</p>}
      </div>

      {suggestions.length > 0 ? (
        <>
          <h4 style={{ margin: "8px 0 4px" }}>{t("link.suggestions")}</h4>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {suggestions.map((s) => <CandidateRow key={`${s.target}:${s.targetId}`} c={s} docAmountMinor={docAmountMinor} chosen={chosen} onChoose={onChoose} disabled={disabled} />)}
          </ul>
        </>
      ) : <p style={{ fontSize: 13, margin: "0 0 8px" }}>{t("link.noSuggestions")}</p>}

      <h4 style={{ margin: "12px 0 4px" }}>{t("link.lookup")}</h4>
      <form onSubmit={(e) => { e.preventDefault(); void lookup(); }} style={{ display: "grid", gap: 8 }} aria-label={t("link.lookup")}>
        <Field label={t("link.target")}>
          <Select value={target} onChange={(e) => { setTarget(e.target.value); setResults(null); }} disabled={disabled}>
            {allowedTargets.map((x) => <option key={x} value={x}>{t(`target.${x}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("link.query")}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={qHint} disabled={disabled} maxLength={200} />
        </Field>
        {finance ? (
          <Field label={t("link.amountRupees")} {...(amountError ? { error: t("link.amountInvalid") } : {})}>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" disabled={disabled} />
          </Field>
        ) : null}
        <div><Button type="submit" variant="secondary" loading={loading} disabled={disabled}>{t("link.search")}</Button></div>
      </form>
      {error ? (
        <div role="alert" style={{ color: "var(--bad)" }}>
          <p style={{ margin: "8px 0 4px" }}><span aria-hidden="true">✕ </span>{error.message}</p>
          {error.reference ? <p style={{ margin: "0 0 4px", fontSize: 12, color: "var(--ink2)" }}>{formatReference(error.reference)}</p> : null}
          {lookupError === "TARGET_UNAVAILABLE" ? <Button size="sm" onClick={() => { void lookup(); }}>{t("action.retry")}</Button> : null}
        </div>
      ) : null}
      {results !== null ? (
        results.length < 1 ? <p style={{ margin: "8px 0 0" }}>{t("link.noResults")}</p> : (
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }} aria-label={t("link.results")}>
            {results.map((c) => <CandidateRow key={`${c.target}:${c.targetId}`} c={c} docAmountMinor={docAmountMinor} chosen={chosen} onChoose={onChoose} disabled={disabled} />)}
          </ul>
        )
      ) : null}
    </section>
  );
}
