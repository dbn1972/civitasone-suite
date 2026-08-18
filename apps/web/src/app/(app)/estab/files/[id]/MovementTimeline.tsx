import { StatusPill } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { OfficerName } from "./OfficerName";

export type FileMovement = {
  id: string;
  fromOfficerId?: string | null;
  toOfficerId: string;
  action?: string | null;
  movedAt: string;
  status?: string | null;
  remarks?: string | null;
};

function actionVerb(action?: string | null): string {
  if (!action) return "Forwarded";
  const a = action.toLowerCase();
  if (a === "forward" || a === "forwarded") return "Forwarded";
  if (a === "refer" || a === "referred") return "Referred";
  if (a === "return" || a === "returned") return "Returned";
  if (a === "receive" || a === "received") return "Received";
  if (a === "dispatch" || a === "dispatched") return "Dispatched";
  return action.charAt(0).toUpperCase() + action.slice(1).replace(/_/g, " ");
}

/**
 * Accessible vertical timeline for a file's movement trail
 * (estab_file_movements). Renders newest-first: date chip → action verb →
 * from-officer → to-officer arrow → status badge.
 */
export function MovementTimeline({ movements }: { movements: FileMovement[] }) {
  const ordered = [...movements].sort(
    (a, b) => new Date(b.movedAt).getTime() - new Date(a.movedAt).getTime(),
  );

  return (
    <ol className="tl" aria-label="File movement trail">
      {ordered.map((m, i) => (
        <li key={m.id} className={i === 0 ? "cur" : "done"}>
          <div className="t" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink2)" }}>
              {formatIndianDate(m.movedAt)}
            </span>
            {actionVerb(m.action)}
            {m.status ? <StatusPill status={m.status.replace(/_/g, " ")} /> : null}
          </div>
          <div className="d">
            {m.fromOfficerId ? <OfficerName id={m.fromOfficerId} /> : "—"}{" "}
            <span aria-hidden="true">→</span>{" "}
            <OfficerName id={m.toOfficerId} />
            {m.remarks ? ` · ${m.remarks}` : ""}
          </div>
        </li>
      ))}
    </ol>
  );
}
