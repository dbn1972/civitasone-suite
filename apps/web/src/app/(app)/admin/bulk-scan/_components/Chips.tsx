"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { fileStateMeta, linkStateMeta, batchStatusTone, BATCH_STATUS_ICON, confidenceBand, BAND_META, type Tone } from "@/lib/bulkScan/status";
import { amountDetailLine, describeLinkReason, type LinkDetail } from "@/lib/bulkScan/linkReason";
import { formatConfidencePct } from "@/lib/scannedDocuments";

/** A status pill. The icon is decorative and the text is always present: status is never conveyed by colour alone. */
export function Chip({ tone, icon, children, title }: { tone: Tone; icon: string; children: ReactNode; title?: string }) {
  return (
    <span className={`pill ${tone} np`} {...(title ? { title } : {})}>
      <span aria-hidden="true">{icon}</span> {children}
    </span>
  );
}

export function FileStateChip({ state }: { state: string }) {
  const t = useTranslations("bulkScan");
  const m = fileStateMeta(state);
  return <Chip tone={m.tone} icon={m.icon}>{t(m.key)}</Chip>;
}

export function BatchStatusChip({ status }: { status: string }) {
  const t = useTranslations("bulkScan");
  const known = ["open", "processing", "completed", "cancelled"].includes(status);
  return <Chip tone={batchStatusTone(status)} icon={BATCH_STATUS_ICON[status] ?? "?"}>{known ? t(`batchStatus.${status}`) : t("batchStatus.unknown")}</Chip>;
}

export function LinkStateChip({ state }: { state: string }) {
  const t = useTranslations("bulkScan");
  const m = linkStateMeta(state);
  return <Chip tone={m.tone} icon={m.icon}>{t(m.key)}</Chip>;
}

/** "91% · High": the band word and glyph accompany the colour. */
export function ConfidenceBadge({ value, threshold }: { value: number | null | undefined; threshold?: number }) {
  const t = useTranslations("bulkScan");
  const band = confidenceBand(value, threshold);
  const m = BAND_META[band];
  return <Chip tone={m.tone} icon={m.icon}>{formatConfidencePct(value)} · {t(`confidence.${band}`)}</Chip>;
}

/** Accessible progress meter (role=progressbar) with a text equivalent; no CSS transition so reduced-motion needs nothing special. */
export function Meter({ percent, label, valueText }: { percent: number; label: string; valueText: string }) {
  const pct = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div className="bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={valueText}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Why a link did not go through: shared reason codes are shown as human copy (unknown codes get generic copy, never the raw code),
 * reviewer-typed text as written, and for an amount mismatch the expected and scanned amounts formatted from the paise digit strings.
 */
export function LinkReasonLine({ reason, detail, empty = "—" }: { reason: string | null | undefined; detail?: LinkDetail | null | undefined; empty?: string }) {
  const t = useTranslations("bulkScan");
  const d = describeLinkReason(reason);
  const a = amountDetailLine(detail);
  if (!d && !a) return <>{empty}</>;
  return (
    <>
      {d ? (d.kind === "code" ? t(d.key) : d.text) : null}
      {a ? <span style={{ display: "block", fontSize: 12 }}>{t("links.amountDetail", a)}</span> : null}
    </>
  );
}
