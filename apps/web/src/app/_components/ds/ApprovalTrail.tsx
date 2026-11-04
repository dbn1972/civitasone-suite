/**
 * ApprovalTrail -- the approval / noting trail section of the record detail template (UX-R5).
 *
 * File-noting style: who (name, designation), what (approved / returned / forwarded ...), when (IST) and the
 * quoted remark. Actor text is ALWAYS a resolved label (lib/records/labels personLabel) -- this component never
 * receives or prints an id. An empty trail says so in one line instead of disappearing.
 */
import type { ReactNode } from "react";
import { formatIndianDateTime } from "@/lib/formatters";

export type TrailEntry = {
  /** Resolved "Name, Designation" (or the honest "Name not available ..."). */
  actor: string;
  /** Human action ("Created", "Approved", "Returned for correction"). */
  action: string;
  at?: string | null;
  remarks?: string | null;
  key?: string;
};

const ACTION_LABEL: Record<string, string> = {
  created: "Created",
  submitted: "Submitted",
  submit: "Submitted",
  approved: "Approved",
  approve: "Approved",
  rejected: "Rejected",
  reject: "Rejected",
  returned: "Returned for correction",
  return: "Returned for correction",
  sent_back: "Returned for correction",
  forwarded: "Forwarded",
  forward: "Forwarded",
  claimed: "Taken up",
  cancelled: "Cancelled",
  closed: "Closed",
  start: "Submitted",
};

/** "approved" -> "Approved", "sent_back" -> "Returned for correction", unknown codes sentence-cased. */
export function trailActionLabel(action: string | null | undefined): string {
  const key = (action ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return "—";
  return ACTION_LABEL[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
}

/** null/undefined = no time recorded (line omitted); a given but empty/unparseable value reads "—", never raw text. */
function when(at: string | null | undefined): string | null {
  if (at === null || at === undefined) return null;
  if (!at || Number.isNaN(new Date(at).getTime())) return "—";
  return formatIndianDateTime(at);
}

export function ApprovalTrail({
  entries,
  title = "Approval trail",
  emptyText = "No approval actions recorded yet.",
  footer,
  byText = "by",
  actionText = trailActionLabel,
}: {
  entries: ReadonlyArray<TrailEntry>;
  title?: string;
  emptyText?: string;
  footer?: ReactNode;
  /** Localised connector between action and actor (default "by"). */
  byText?: string;
  /** Localised action label (default: trailActionLabel, English). */
  actionText?: (action: string) => string;
}) {
  const headingId = "approval-trail-heading";
  return (
    <section className="card" aria-labelledby={headingId} style={{ marginTop: 18 }}>
      <div className="card-h">
        <h2 id={headingId} style={{ fontSize: 15, margin: 0 }}>{title}</h2>
      </div>
      <div className="pad">
        {entries.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>{emptyText}</p>
        ) : (
          <ol className="tl" style={{ margin: 0 }}>
            {entries.map((e, i) => {
              const at = when(e.at);
              return (
                <li key={e.key ?? i}>
                  <div className="tl-dot" />
                  <div className="tl-body">
                    <div className="tl-title">
                      <strong>{actionText(e.action)}</strong>
                      <span style={{ color: "var(--ink2)" }}> {byText} </span>
                      <span>{e.actor}</span>
                    </div>
                    {at ? <div className="tl-sub">{at}</div> : null}
                    {e.remarks && e.remarks.trim() ? (
                      <blockquote style={{ margin: "4px 0 0", paddingLeft: 10, borderLeft: "3px solid var(--line)", fontSize: 13, color: "var(--ink)" }}>
                        {e.remarks.trim()}
                      </blockquote>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {footer}
      </div>
    </section>
  );
}
