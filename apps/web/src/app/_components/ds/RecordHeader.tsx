/**
 * RecordHeader -- the consistent header of the record detail template (UX-R5, redesign-5-record-detail.html).
 *
 *   [Back]                                                     [ one primary action ]
 *   Sanction W7-SAN-2026-0012
 *   Purchase of laptops for the DDO office
 *   Status [Approved]  ·  Amount ₹1,44,457.63  ·  Sanctioned by Asha Rao, Section Officer
 *   Approved by N. Gupta, DDO on 30 Oct 2026.            <- outcome line on a finished record
 *
 * Exactly one primary action, always in the header right (PageHeader `.ph-act`), on every record type.
 * The status badge always carries text (StatusPill). Amounts are minor units formatted in Indian grouping.
 * Party values must already be resolved labels (lib/records/labels) -- never ids.
 */
import type { ReactNode } from "react";
import { PageHeader } from "./PageHeader";
import { StatusPill } from "./StatusPill";
import { formatMoney } from "@/lib/formatters";

export type RecordParty = { label: string; value: ReactNode };

export interface RecordHeaderProps {
  /** Record type as officers say it: "Sanction", "Bill", "Purchase order". */
  kind: string;
  /** The business number (W7-SAN-..., PO/2026/0030). Falls back to "(number not yet allocated)". */
  recordNo?: string | null;
  /** Subject / title line under the heading. */
  subtitle?: ReactNode;
  status?: string | null;
  statusLabel?: string;
  /** Amount in minor units (paise), bigint-safe string accepted. */
  amountMinor?: bigint | number | string | null;
  amountLabel?: string;
  parties?: ReadonlyArray<RecordParty | null | false | undefined>;
  /** The ONE primary action (a Button / Link styled primary). Omit when the status allows none. */
  primaryAction?: ReactNode;
  /** Secondary actions, rendered before the primary in the same place. */
  secondaryActions?: ReactNode;
  /** Outcome line for a finished record ("Approved by N. Gupta, DDO on 30 Oct 2026."). */
  outcome?: ReactNode;
  back?: string;
  backLabel?: string;
  help?: string;
  /** Localised "Status" label (default English). */
  statusText?: string;
  /** Localised heading when no number is allocated yet (default "<kind> (number not yet allocated)"). */
  unnumberedTitle?: string;
}

export function RecordHeader({
  kind, recordNo, subtitle, status, statusLabel, amountMinor, amountLabel = "Amount",
  parties = [], primaryAction, secondaryActions, outcome, back, backLabel, help,
  statusText = "Status", unnumberedTitle,
}: RecordHeaderProps) {
  const no = recordNo && recordNo.trim() ? recordNo.trim() : null;
  const shownParties = parties.filter((p): p is RecordParty => Boolean(p));
  const hasAmount = amountMinor !== null && amountMinor !== undefined && amountMinor !== "";
  const actions = primaryAction || secondaryActions ? (
    <span data-record-actions="" style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {secondaryActions}
      {primaryAction ? <span data-primary-action="">{primaryAction}</span> : null}
    </span>
  ) : undefined;
  return (
    <header data-record-header="" style={{ marginBottom: 14 }}>
      <PageHeader
        title={no ? <>{kind} <span className="mono">{no}</span></> : (unnumberedTitle ?? `${kind} (number not yet allocated)`)}
        subtitle={subtitle}
        back={back}
        backLabel={backLabel}
        help={help}
        actions={actions}
      />
      <dl
        aria-label={`${kind} summary`}
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 20px", margin: "6px 0 0", fontSize: 13 }}
      >
        {status ? (
          <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <dt style={{ color: "var(--ink2)" }}>{statusText}</dt>
            <dd style={{ margin: 0 }}><StatusPill status={status} {...(statusLabel ? { label: statusLabel } : {})} /></dd>
          </div>
        ) : null}
        {hasAmount ? (
          <div style={{ display: "inline-flex", gap: 6, alignItems: "baseline" }}>
            <dt style={{ color: "var(--ink2)" }}>{amountLabel}</dt>
            <dd style={{ margin: 0, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{formatMoney(amountMinor)}</dd>
          </div>
        ) : null}
        {shownParties.map((p) => (
          <div key={p.label} style={{ display: "inline-flex", gap: 6, alignItems: "baseline", minWidth: 0 }}>
            <dt style={{ color: "var(--ink2)" }}>{p.label}</dt>
            <dd style={{ margin: 0, fontWeight: 600, overflowWrap: "anywhere" }}>{p.value}</dd>
          </div>
        ))}
      </dl>
      {outcome ? (
        <p role="status" data-record-outcome="" style={{ margin: "8px 0 0", fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{outcome}</p>
      ) : null}
    </header>
  );
}
