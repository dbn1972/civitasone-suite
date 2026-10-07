import { Card } from "@/app/_components/ds";
import type { MunicipalHistoryEvent } from "../_data/municipalApi";

const ACTION_LABELS: Record<string, string> = {
  create: "Application drafted",
  submit: "Submitted",
  inspect: "Inspection / scrutiny started",
  approve: "Approved",
  reject: "Rejected",
  withdraw: "Withdrawn",
  issue: "Licence issued",
  fee_payment: "Fee paid",
};

function label(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}

function fmt(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString("en-IN");
}

/**
 * GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-02 — read-only officer timeline
 * of an application's status transitions, from the service's history endpoint.
 */
export function RecordHistory({ events }: { events: MunicipalHistoryEvent[] }) {
  return (
    <Card title={`History${events.length ? ` (${events.length})` : ""}`}>
      <div className="pad">
        {events.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>No history recorded yet.</p>
        ) : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
            {events.map((e) => (
              <li key={e.id} style={{ borderInlineStart: "2px solid var(--line)", paddingInlineStart: 12 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {label(e.action)}
                  <span style={{ fontWeight: 400, color: "var(--ink2)" }}>
                    {e.fromStatus ? ` · ${e.fromStatus} → ${e.toStatus}` : ` · ${e.toStatus}`}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{fmt(e.createdAt)}</div>
                {e.note ? <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 2 }}>{e.note}</div> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
