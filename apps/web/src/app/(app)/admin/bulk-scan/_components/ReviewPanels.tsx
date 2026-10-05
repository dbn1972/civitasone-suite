"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Field, Input, Select, Textarea } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { nextWordIndex, safeMaskedPreview, type FieldDraft } from "@/lib/bulkScan/review";
import { confidenceBand, BAND_META } from "@/lib/bulkScan/status";
import type {
  DegradedPage, DocTypeOption, LinkRow, ReviewClassification, ReviewField, ReviewPage, ReviewPiiFinding,
} from "@/lib/bulkScan/types";
import { formatConfidencePct } from "@/lib/scannedDocuments";
import { Chip, ConfidenceBadge } from "./Chips";

/** Field kinds whose values are PII: shown masked and never editable. */
export const PII_FIELD_KINDS: readonly string[] = ["aadhaar", "pan", "account_no", "phone", "email"];

export function DegradedBanner({ pages }: { pages: DegradedPage[] }) {
  const t = useTranslations("bulkScan");
  if (pages.length < 1) return null;
  return (
    <div role="status" className="card" style={{ padding: 12, borderInlineStart: "4px solid var(--warn)" }}>
      <strong><span aria-hidden="true">⚠ </span>{t("review.degradedTitle")}</strong>
      <p style={{ margin: "4px 0" }}>{t("review.degradedBody")}</p>
      <ul style={{ margin: 0, paddingInlineStart: 20 }}>
        {pages.map((p) => (
          <li key={p.pageNumber}>
            {t("review.degradedPage", { page: p.pageNumber })}
            {p.droppedScripts.length > 0 ? ` — ${t("review.degradedScripts", { scripts: p.droppedScripts.join(", ") })}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Maker-checker state of a linked filing: awaiting approval by a DIFFERENT user. */
export function MakerCheckerBanner({ link, currentUserId }: { link: LinkRow; currentUserId: string | null }) {
  const t = useTranslations("bulkScan");
  const mine = currentUserId !== null && link.requestedBy === currentUserId;
  return (
    <div role="status" className="card" style={{ padding: 12, borderInlineStart: "4px solid var(--info)" }}>
      <strong><span aria-hidden="true">⏳ </span>{t("review.awaitingTitle")}</strong>
      <p style={{ margin: "4px 0" }}>{mine ? t("review.awaitingMine") : t("review.awaitingOther")}</p>
      <p style={{ margin: 0, fontSize: 13 }}>
        {t("review.awaitingTarget", { target: t(`target.${link.target}`), id: link.targetId })}{" "}
        <Link href="/admin/bulk-scan/links">{t("review.openLinks")}</Link>
      </p>
    </div>
  );
}

export function ClassificationPanel({ cls, docTypes, docType, onDocType, onPick, disabled, selectRef }: {
  cls: ReviewClassification; docTypes: DocTypeOption[]; docType: string | null; onDocType: (id: string) => void; onPick: (id: string) => void; disabled: boolean;
  selectRef: React.RefObject<HTMLSelectElement>;
}) {
  const t = useTranslations("bulkScan");
  const labelOf = (id: string | null): string => (id ? docTypes.find((d) => d.id === id)?.label ?? id : "—");
  const options = docType && !docTypes.some((d) => d.id === docType) ? [...docTypes, { id: docType, label: docType }] : docTypes;
  return (
    <section aria-labelledby="cls-h" className="card" style={{ padding: 12 }}>
      <h3 id="cls-h" style={{ margin: "0 0 8px" }}>{t("review.classification")}</h3>
      <Field label={t("review.docType")}>
        <Select ref={selectRef} value={docType ?? ""} onChange={(e) => onDocType(e.target.value)} disabled={disabled}>
          {docType === null ? <option value="">—</option> : null}
          {options.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </Select>
      </Field>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "8px 0" }}>
        <ConfidenceBadge value={cls.confidence} />
        {cls.uncertain ? <Chip tone="warn" icon="?">{t("review.uncertain")}</Chip> : null}
        {cls.presetDocType ? <Chip tone="info" icon="📌">{t("review.preset", { type: labelOf(cls.presetDocType) })}</Chip> : null}
      </div>
      {cls.presetDocType ? <p style={{ fontSize: 12, margin: "0 0 8px" }}>{t("review.presetHelp")}</p> : null}
      {cls.candidates.length > 0 ? (
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 13 }}>{t("review.candidates")}</p>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
            {cls.candidates.map((c, i) => (
              <li key={c.docType} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span><strong>{i + 1}.</strong> {c.label} — {t("review.score", { score: Math.round(c.score * 100) })}</span>
                <button type="button" className="btn sm" disabled={disabled || docType === c.docType} onClick={() => onPick(c.docType)}
                  aria-keyshortcuts={String(i + 1)} aria-label={t("review.pickCandidate", { label: c.label, key: i + 1 })}>
                  {docType === c.docType ? t("review.picked") : t("review.pick", { key: i + 1 })}
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {cls.evidence.length > 0 ? (
        <details style={{ marginTop: 8 }}>
          <summary>{t("review.evidence")}</summary>
          <ul style={{ margin: "4px 0 0", paddingInlineStart: 18 }}>{cls.evidence.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}

export function FieldsPanel({ fields, drafts, onChange, disabled, errors }: {
  fields: ReviewField[]; drafts: FieldDraft[]; onChange: (index: number, value: string) => void; disabled: boolean; errors: Record<number, boolean>;
}) {
  const t = useTranslations("bulkScan");
  if (fields.length < 1) return <section aria-labelledby="fld-h" className="card" style={{ padding: 12 }}><h3 id="fld-h" style={{ margin: "0 0 8px" }}>{t("review.fields")}</h3><p style={{ margin: 0 }}>{t("review.noFields")}</p></section>;
  return (
    <section aria-labelledby="fld-h" className="card" style={{ padding: 12 }}>
      <h3 id="fld-h" style={{ margin: "0 0 8px" }}>{t("review.fields")}</h3>
      <div style={{ display: "grid", gap: 10 }}>
        {fields.map((f, i) => {
          const pii = PII_FIELD_KINDS.includes(f.kind);
          const isAmount = f.kind === "amount_inr";
          const label = ["date", "amount_inr", "reference_no", "file_no", "pan", "aadhaar", "ifsc", "phone", "email", "employee_no", "voucher_no", "account_no"].includes(f.kind) ? t(`field.${f.kind}`) : f.kind;
          return (
            <div key={i}>
              <Field label={<>{label}{f.pageNumber !== null ? ` (${t("review.onPage", { page: f.pageNumber })})` : ""}</>} {...(errors[i] ? { error: t("review.fieldRequired") } : {})}>
                <Input value={drafts[i]?.value ?? f.value} onChange={(e) => onChange(i, e.target.value)} disabled={disabled || pii} {...(pii ? { "aria-describedby": `pii-note-${i}` } : isAmount ? { "aria-describedby": `amt-unit-${i}`, placeholder: t("review.amountPlaceholder"), inputMode: "decimal" as const } : {})} />
              </Field>
              <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <ConfidenceBadge value={f.confidence} />
                {isAmount ? <span id={`amt-unit-${i}`} style={{ fontSize: 12 }}>{t("review.amountUnit")}</span> : null}
                {isAmount && /^\d{1,18}$/.test((drafts[i]?.value ?? f.value).trim()) ? <span style={{ fontSize: 12 }}>{t("review.amountHint", { amount: formatMoney((drafts[i]?.value ?? f.value).trim()) })}</span> : null}
                {pii ? <span id={`pii-note-${i}`} style={{ fontSize: 12 }}>{t("review.piiReadOnly")}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function PiiPanel({ findings }: { findings: ReviewPiiFinding[] }) {
  const t = useTranslations("bulkScan");
  return (
    <section aria-labelledby="pii-h" className="card" style={{ padding: 12 }}>
      <h3 id="pii-h" style={{ margin: "0 0 8px" }}>{t("review.pii")}</h3>
      {findings.length < 1 ? <p style={{ margin: 0 }}>{t("review.noPii")}</p> : (
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
          {findings.map((f, i) => (
            <li key={i}>
              <strong>{["aadhaar", "pan", "bank_account", "phone", "email"].includes(f.type) ? t(`pii.${f.type}`) : f.type}</strong>
              {f.pageNumber !== null ? ` · ${t("review.onPage", { page: f.pageNumber })}` : ""} · {["mask", "redact", "flag"].includes(f.action) ? t(`piiAction.${f.action}`) : f.action}
              {f.maskedPreview ? <> · <code>{safeMaskedPreview(f.maskedPreview)}</code></> : null}
            </li>
          ))}
        </ul>
      )}
      <p style={{ fontSize: 12, margin: "6px 0 0" }}>{t("review.piiNote")}</p>
    </section>
  );
}

/**
 * The recognised words of the current page as a roving-tabindex list: Arrow keys / Home / End move between words, and
 * hovering or focusing a word highlights its box on the page (and vice versa via `active`).
 */
export function WordsPanel({ page, active, onActive, onReveal, threshold }: {
  page: ReviewPage; active: number | null; onActive: (i: number | null) => void; onReveal: (i: number) => void; threshold: number;
}) {
  const t = useTranslations("bulkScan");
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [tab, setTab] = useState(0);
  const count = page.words.length;
  const onKeyDown = (e: React.KeyboardEvent, i: number): void => {
    const n = nextWordIndex(i, count, e.key);
    if (n === null) return;
    e.preventDefault();
    setTab(n);
    refs.current[n]?.focus();
  };
  return (
    <section aria-labelledby="words-h" className="card" style={{ padding: 12 }}>
      <h3 id="words-h" style={{ margin: "0 0 8px" }}>{t("review.words", { page: page.pageNumber })}</h3>
      {count < 1 ? <p style={{ margin: 0 }}>{t("review.noWords")}</p> : (
        <>
          <p style={{ fontSize: 12, margin: "0 0 6px" }}>{t("review.wordsHelp")}</p>
          <div role="group" aria-label={t("review.wordsGroup")} style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 220, overflow: "auto" }}>
            {page.words.map((w, i) => {
              const band = confidenceBand(w.confidence, threshold);
              return (
                <button
                  key={i} type="button" ref={(el) => { refs.current[i] = el; }} tabIndex={i === tab ? 0 : -1} data-band={band}
                  aria-pressed={active === i}
                  onMouseEnter={() => onActive(i)} onMouseLeave={() => onActive(null)} onFocus={() => { setTab(i); onActive(i); onReveal(i); }} onBlur={() => onActive(null)}
                  onKeyDown={(e) => onKeyDown(e, i)}
                  style={{
                    padding: "1px 5px", background: active === i ? "var(--infobg)" : "transparent", font: "inherit", cursor: "pointer",
                    border: `${active === i ? 2 : 1}px ${band === "high" ? "solid" : band === "medium" ? "dashed" : "dotted"} ${band === "high" ? "var(--good)" : band === "medium" ? "var(--warn)" : "var(--bad)"}`,
                    borderRadius: 4, color: "var(--ink)",
                  }}
                >
                  {band === "low" || band === "medium" ? <span aria-hidden="true">{BAND_META[band].icon}</span> : null}
                  {w.text}
                  <span className="sr-only"> ({t(`confidence.${band}`)} {formatConfidencePct(w.confidence)})</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export function TextEditor({ pages, edited, onChange, disabled }: { pages: ReviewPage[]; edited: Record<number, string>; onChange: (page: number, text: string) => void; disabled: boolean }) {
  const t = useTranslations("bulkScan");
  return (
    <details className="card" style={{ padding: 12 }}>
      <summary><strong>{t("review.editText")}</strong></summary>
      <p style={{ fontSize: 12 }}>{t("review.editTextHelp")}</p>
      <div style={{ display: "grid", gap: 10 }}>
        {pages.map((p) => (
          <Field key={p.pageNumber} label={t("review.pageText", { page: p.pageNumber })}>
            <Textarea rows={6} value={edited[p.pageNumber] ?? p.text} onChange={(e) => onChange(p.pageNumber, e.target.value)} disabled={disabled} />
          </Field>
        ))}
      </div>
    </details>
  );
}
