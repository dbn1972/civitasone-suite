"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Select } from "@/app/_components/ds";
import type { Direction } from "@/lib/bulkScan/changeDirection";
import { issueAt, OCR_LANGS, PREPROCESS_STEPS, percentToRatio, ratioToPercent, type ChainEntry, type FieldIssue } from "@/lib/bulkScan/settingsSchema";
import type { ProviderInfo } from "@/lib/bulkScan/types";
import { Chip } from "./Chips";

/** Parse a number input: empty or non-numeric becomes NaN (the schema reports it as invalid), never silently 0. */
export const numFromInput = (v: string): number => (v.trim() === "" ? Number.NaN : Number(v));

/** Inline message for a field. `percent` rescales min/max (stored as 0..1 ratios) to the 0..100 the admin typed. */
export function useIssueText(issues: readonly FieldIssue[]): (path: string, percent?: boolean) => string | undefined {
  const t = useTranslations("bulkScan");
  return (path, percent = false) => {
    const i = issueAt(issues, path);
    if (!i) return undefined;
    const params = percent ? Object.fromEntries(Object.entries(i.params).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 100) : v])) : i.params;
    return t(`settings.${i.key}`, params);
  };
}

export function Fieldset({ legend, help, children }: { legend: string; help?: string; children: ReactNode }) {
  return (
    <fieldset className="card" style={{ padding: 16, margin: 0, display: "grid", gap: 12, border: "1px solid var(--line)" }}>
      <legend style={{ fontWeight: 650, padding: "0 6px" }}>{legend}</legend>
      {help ? <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>{help}</p> : null}
      {children}
    </fieldset>
  );
}

/** A 0..1 ratio edited as a percentage. `optional` renders an empty box meaning "use the server default". */
export function PercentField({ label, value, onChange, error, help, optional = false, disabled = false }: {
  label: string; value: number | undefined; onChange: (v: number | undefined) => void; error?: string | undefined; help?: string; optional?: boolean; disabled?: boolean;
}) {
  const t = useTranslations("bulkScan");
  return (
    <Field label={label} {...(error ? { error } : {})}>
      <Input
        type="number" min={0} max={100} step={0.1} inputMode="decimal" disabled={disabled}
        value={value === undefined ? "" : Number.isNaN(value) ? "" : String(ratioToPercent(value))}
        placeholder={optional ? t("settings.serverDefault") : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw.trim() === "" ? (optional ? undefined : Number.NaN) : percentToRatio(Number(raw)));
        }}
      />
      {help ? <span style={{ fontSize: 12, color: "var(--ink2)" }}>{help}</span> : null}
    </Field>
  );
}

export function LanguageGroup({ value, onChange, error, disabled = false }: { value: readonly string[]; onChange: (v: string[]) => void; error?: string | undefined; disabled?: boolean }) {
  const t = useTranslations("bulkScan");
  return (
    <div role="group" aria-label={t("settings.languages")}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{t("settings.languages")}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {OCR_LANGS.map((l) => (
          <label key={l} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" disabled={disabled} checked={value.includes(l)} onChange={(e) => onChange(e.target.checked ? [...value, l] : value.filter((x) => x !== l))} />
            {t(`lang.${l}`)}
          </label>
        ))}
      </div>
      <span style={{ fontSize: 12, color: "var(--ink2)" }}>{t("settings.languagesHelp")}</span>
      {error ? <div role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div> : null}
    </div>
  );
}

export function StepsGroup({ value, onChange, error, disabled = false }: { value: readonly string[]; onChange: (v: string[]) => void; error?: string | undefined; disabled?: boolean }) {
  const t = useTranslations("bulkScan");
  return (
    <div role="group" aria-label={t("settings.steps")}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{t("settings.steps")}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {PREPROCESS_STEPS.map((s) => (
          <label key={s} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" disabled={disabled} checked={value.includes(s)} onChange={(e) => onChange(e.target.checked ? [...value, s] : value.filter((x) => x !== s))} />
            {t(`step.${s}`)}
          </label>
        ))}
      </div>
      {error ? <div role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div> : null}
    </div>
  );
}

/** Ordered provider chain: the first provider is tried first, later ones are fallbacks (and best-of candidates). */
export function ProviderChainEditor({ value, onChange, providers, providersFailed, error, disabled = false }: {
  value: ChainEntry[]; onChange: (v: ChainEntry[]) => void; providers: ProviderInfo[]; providersFailed: boolean; error?: string | undefined; disabled?: boolean;
}) {
  const t = useTranslations("bulkScan");
  const info = (id: string): ProviderInfo | undefined => providers.find((p) => p.id === id);
  const addable = providers.filter((p) => !value.some((v) => v.id === p.id));
  const move = (i: number, d: -1 | 1): void => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div role="group" aria-labelledby="chain-h">
      <div id="chain-h" style={{ fontWeight: 600, marginBottom: 4 }}>{t("settings.chain")}</div>
      <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--ink2)" }}>{t("settings.chainHelp")}</p>
      {providersFailed ? <p role="alert" style={{ color: "var(--warn)" }}><span aria-hidden="true">⚠ </span>{t("settings.providersUnavailable")}</p> : null}
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {value.map((e, i) => {
          const p = info(e.id);
          const label = p?.label ?? t(`provider.${e.id}`);
          return (
            <li key={e.id} className="card" style={{ padding: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <strong>{i + 1}. {label}</strong>
              {p ? (p.available ? <Chip tone="good" icon="✓">{t("settings.available")}</Chip> : <Chip tone="bad" icon="✕">{t("settings.unavailable")}</Chip>) : null}
              {p?.sandbox ? <Chip tone="warn" icon="🧪">{t("settings.sandbox")}</Chip> : null}
              <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                {t("settings.timeoutSeconds")}
                <Input type="number" min={1} max={600} style={{ width: 90 }} disabled={disabled} value={Number.isNaN(e.timeoutMs) ? "" : String(Math.round(e.timeoutMs / 1000))}
                  onChange={(ev) => onChange(value.map((x, n) => (n === i ? { ...x, timeoutMs: numFromInput(ev.target.value) * 1000 } : x)))} />
              </label>
              <span style={{ display: "inline-flex", gap: 4, marginInlineStart: "auto" }}>
                <Button size="sm" variant="ghost" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={t("settings.moveUp", { name: label })}>↑</Button>
                <Button size="sm" variant="ghost" disabled={disabled || i === value.length - 1} onClick={() => move(i, 1)} aria-label={t("settings.moveDown", { name: label })}>↓</Button>
                <Button size="sm" variant="ghost" disabled={disabled || value.length <= 1} onClick={() => onChange(value.filter((_, n) => n !== i))} aria-label={t("settings.removeProvider", { name: label })}>{t("action.remove")}</Button>
              </span>
            </li>
          );
        })}
      </ol>
      {addable.length > 0 ? (
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "end" }}>
          <Field label={t("settings.addProvider")}>
            <Select value="" disabled={disabled} onChange={(e) => { if (e.target.value) onChange([...value, { id: e.target.value, timeoutMs: 120_000 }]); }}>
              <option value="">{t("settings.chooseProvider")}</option>
              {addable.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{p.label}{p.available ? "" : ` (${t("settings.unavailable")})`}</option>)}
            </Select>
          </Field>
        </div>
      ) : null}
      {error ? <div role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div> : null}
    </div>
  );
}

/** Per-field hint: does this change apply immediately (tightening) or need a second approver (loosening)? Nothing when unchanged. */
export function DirectionHint({ direction }: { direction: Direction | undefined }) {
  const t = useTranslations("bulkScan");
  if (!direction || direction === "unchanged") return null;
  const loosening = direction === "loosening";
  return (
    <span role="note" style={{ display: "block", fontSize: 12, color: loosening ? "var(--bad)" : "var(--ink2)" }}>
      <span aria-hidden="true">{loosening ? "⚠ " : "✓ "}</span>{loosening ? t("settings.directionLoosening") : t("settings.directionTightening")}
    </span>
  );
}
