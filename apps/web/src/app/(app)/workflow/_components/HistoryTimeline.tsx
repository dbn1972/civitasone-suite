/**
 * Transition-history timeline (server component). Renders the append-only
 * workflow.transition_history for an instance as an accessible ordered list,
 * newest-first, with from→to step, action, decision and actor.
 */
import { formatIndianDate } from "@/lib/formatters";
import type { WorkflowTransition } from "../_data/workflowTypes";
import { titleCase } from "../_data/workflowTypes";

function decisionPill(decision: string | null): string {
  const d = (decision ?? "").toLowerCase();
  if (d === "approve" || d === "approved") return "good";
  if (d === "reject" || d === "rejected") return "bad";
  if (d === "return" || d === "returned") return "warn";
  return "mut";
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = formatIndianDate(iso);
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}

export function HistoryTimeline({ transitions }: { transitions: WorkflowTransition[] }) {
  const ordered = [...transitions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <ol className="tl">
      {ordered.map((t, i) => (
        <li key={t.id || i} className={i === 0 ? "cur" : "done"}>
          <div className="t" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {titleCase(t.action) || "Transition"}
            {t.decision && (
              <span className={`pill ${decisionPill(t.decision)} np`} style={{ fontSize: 11 }}>
                {titleCase(t.decision)}
              </span>
            )}
          </div>
          <div className="m">
            {t.fromNode || t.toNode ? (
              <>
                {t.fromNode ?? "start"} <span aria-hidden="true">→</span> {t.toNode ?? "—"}
              </>
            ) : (
              "—"
            )}
          </div>
          <div className="d">
            {fmtTime(t.createdAt)} · actor <span className="mono">{t.actorId.slice(0, 8)}…</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
