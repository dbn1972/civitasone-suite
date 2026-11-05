/**
 * ApprovalTrail -- the approval / noting trail section of the record detail template (UX-R5).
 *
 * File-noting style: who (name, designation), what (approved / returned / forwarded ...), when (IST) and the
 * quoted remark. Actor text is ALWAYS a resolved label (lib/records/labels personLabel) -- this component never
 * receives or prints an id. An empty trail says so in one line instead of disappearing.
 */
import { useId, type ReactNode } from "react";
import { formatIndianDateTime } from "@/lib/formatters";
import { defaultRecordT, useRecordT, type RecordT } from "@/lib/records/messages";

export type TrailEntry = {
  /** Resolved "Name, Designation" (or the honest "Name not available ..."). */
  actor: string;
  /** Human action ("Created", "Approved", "Returned for correction"). */
  action: string;
  at?: string | null;
  remarks?: string | null;
  key?: string;
};

/** Action codes (and their spellings) -> the recordUi `action.<code>` message. */
const ACTION_KEY: Record<string, string> = {
  created: "created",
  submitted: "submitted",
  submit: "submitted",
  start: "submitted",
  approved: "approved",
  approve: "approved",
  rejected: "rejected",
  reject: "rejected",
  returned: "returned",
  return: "returned",
  sent_back: "returned",
  forwarded: "forwarded",
  forward: "forwarded",
  claimed: "claimed",
  cancelled: "cancelled",
  closed: "closed",
  lodged: "lodged",
  raised: "raised",
  passed_for_payment: "passed_for_payment",
};

/**
 * "approved" -> "Approved" / "अनुमोदित", "sent_back" -> "Returned for correction", unknown codes sentence-cased.
 * `t` is the recordUi translator (English when omitted).
 */
export function trailActionLabel(action: string | null | undefined, t: RecordT = defaultRecordT): string {
  const key = (action ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return "—";
  const known = ACTION_KEY[key];
  if (known && t.has(`action.${known}`)) return t(`action.${known}`);
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
}

/** null/undefined = no time recorded (line omitted); a given but empty/unparseable value reads "—", never raw text. */
function when(at: string | null | undefined): string | null {
  if (at === null || at === undefined) return null;
  if (!at || Number.isNaN(new Date(at).getTime())) return "—";
  return formatIndianDateTime(at);
}

export function ApprovalTrail({
  entries,
  title,
  emptyText,
  footer,
  byText,
  actionText,
}: {
  entries: ReadonlyArray<TrailEntry>;
  title?: string;
  emptyText?: string;
  footer?: ReactNode;
  /** Override of the connector between action and actor (default: recordUi `trailBy`, localised). */
  byText?: string;
  /** Override of the action label (default: trailActionLabel via recordUi `action.*`, localised). */
  actionText?: (action: string) => string;
}) {
  const t = useRecordT();
  const headingId = `${useId()}-approval-trail-heading`;
  const shownTitle = title ?? t("trailTitle");
  const shownEmpty = emptyText ?? t("trailEmpty");
  const shownBy = byText ?? t("trailBy");
  const label = actionText ?? ((a: string) => trailActionLabel(a, t));
  return (
    <section className="card" aria-labelledby={headingId} style={{ marginTop: 18 }}>
      <div className="card-h">
        <h2 id={headingId} style={{ fontSize: 15, margin: 0 }}>{shownTitle}</h2>
      </div>
      <div className="pad">
        {entries.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>{shownEmpty}</p>
        ) : (
          <ol className="tl" style={{ margin: 0 }}>
            {entries.map((e, i) => {
              const at = when(e.at);
              return (
                <li key={e.key ?? i}>
                  <div className="tl-dot" />
                  <div className="tl-body">
                    <div className="tl-title">
                      <strong>{label(e.action)}</strong>
                      <span style={{ color: "var(--ink2)" }}> {shownBy} </span>
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
