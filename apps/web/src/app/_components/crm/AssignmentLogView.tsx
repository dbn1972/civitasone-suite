"use client";
/**
 * AssignmentLogView — AS-001/AS-002 audit trail plus the AS-004 ageing/overdue
 * indicator on the lead detail. Shows who owned the lead, when, via which rule
 * and by which method (auto/manual/transfer). The header surfaces how long the
 * lead has sat since its latest assignment and whether it is still awaiting
 * acceptance. Every stat is gated on the load source: on a failed load we render
 * "—" + DataSourceBadge rather than a fabricated "assigned 0m ago".
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { EmptyState } from "../ds";
import {
  getAssignmentLog,
  ageingFromLog,
  formatAgeing,
  type AssignmentLogEntry,
  type AsSource,
} from "@/lib/crm/assignment";

const METHOD_LABELS: Record<AssignmentLogEntry["method"], string> = {
  auto: "Auto (rules)",
  manual: "Manual",
  transfer: "Transfer",
};

export function AssignmentLogView({ leadId }: { leadId: string }) {
  const [log, setLog] = useState<AssignmentLogEntry[]>([]);
  const [source, setSource] = useState<AsSource | "loading">("loading");
  const headingId = useId();

  useEffect(() => {
    let live = true;
    (async () => {
      setSource("loading");
      const { data, source: s } = await getAssignmentLog(leadId);
      if (!live) return;
      setLog(data);
      setSource(s);
    })();
    return () => { live = false; };
  }, [leadId]);

  const isError = source === "error";
  const ageing = ageingFromLog(log);

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Assignment history</h3>
        {isError ? <DataSourceBadge source="error" /> : null}
      </div>

      <div className="pad" style={{ display: "flex", gap: 24, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Current owner</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {isError || !ageing.latest ? "—" : ageing.latest.ownerId || "unassigned"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Age since assigned</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {isError || !ageing.latest ? "—" : formatAgeing(ageing.minutesSinceAssigned)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Status</div>
          <div>
            {isError || !ageing.latest ? (
              <span style={{ fontSize: 20, fontWeight: 700 }}>—</span>
            ) : ageing.pendingAcceptance ? (
              <span className="pill warn" role="status">Awaiting acceptance</span>
            ) : (
              <span className="pill ok" role="status">Accepted</span>
            )}
          </div>
        </div>
      </div>

      {source === "loading" ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: "0 12px 12px" }}>
          Loading assignment history…
        </p>
      ) : log.length === 0 ? (
        <EmptyState
          icon="🧾"
          title={isError ? "Assignment history unavailable" : "Not assigned yet"}
          message={isError ? "We couldn't load the assignment history just now." : "This lead has not been assigned to an owner yet."}
        />
      ) : (
        <div className="pad">
          <ul className="tl" aria-labelledby={headingId}>
            {log.map((e, idx) => (
              <li key={idx} className={idx === 0 ? "cur" : "done"}>
                <div className="t">
                  <strong>{e.ownerId || "unassigned"}</strong>
                  <span className="pill info" style={{ marginLeft: 8 }}>{METHOD_LABELS[e.method]}</span>
                  {e.acceptedAt ? <span className="pill ok" style={{ marginLeft: 6 }}>accepted</span> : null}
                </div>
                {e.assignedAt ? <div className="d">Assigned {e.assignedAt}{e.assignedBy ? ` by ${e.assignedBy}` : ""}</div> : null}
                {e.ruleId ? <div className="d">Rule: {e.ruleId}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
