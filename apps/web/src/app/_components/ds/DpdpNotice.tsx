/**
 * GAP-WORKS-CONTRACTORS-NEW-03: a small, reusable DPDP purpose/notice shown
 * above personal-identifier form fields (PAN, email, mobile). Under the
 * Digital Personal Data Protection Act, a data fiduciary must give notice of
 * the PURPOSE for which personal data is collected. This renders that notice
 * as `role="note"` so assistive tech announces it.
 *
 * DECISION (flagged for HUMAN REVIEW — legal/DPO sign-off): the default
 * wording below is a safe, factual placeholder stating the collection
 * purpose, that the record is retained for the empanelment's statutory life,
 * and that changes are logged (works-service emits an audit event on every
 * contractor create/update — confirmed in modules/contractor/consumer.ts). The
 * exact approved wording and the data-fiduciary contact must be confirmed by
 * legal before this ships.
 */
export interface DpdpNoticeProps {
  /** The specific purpose, e.g. "contractor empanelment and TDS/GST compliance". */
  purpose: string;
  className?: string;
}

export function DpdpNotice({ purpose, className }: DpdpNoticeProps) {
  return (
    <div
      role="note"
      aria-label="Data protection notice"
      className={className}
      style={{
        background: "var(--infobg, #eff6ff)",
        border: "1px solid var(--line, #dbeafe)",
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 12,
        color: "var(--muted, #475569)",
        lineHeight: 1.5,
      }}
    >
      <strong style={{ display: "block", marginBottom: 2, color: "var(--ink)" }}>
        Why we collect this
      </strong>
      The personal identifiers below (PAN, email, mobile) are collected for{" "}
      {purpose}, retained for the statutory life of the record, and processed under
      the Digital Personal Data Protection Act. Changes to this record are logged.
    </div>
  );
}
