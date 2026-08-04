"use client";
/**
 * OverdueTaskAlerts — AC-005 (alerts). Lists the open tasks that are already
 * overdue, worst-aged first, so a manager can act before escalation fires. The
 * overdue count is gated on source==="error" → "—" + saved-info badge, never a
 * fabricated zero. Ageing is shown in plain words (e.g. "2d 3h").
 */
import { useEffect, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { StatGrid, StatCard, EmptyState } from "../ds";
import { getOverdueTasks, formatAgeing, type OverdueTask, type AaSource } from "@/lib/crm/activityAccount";

function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function OverdueTaskAlerts() {
  const [tasks, setTasks] = useState<OverdueTask[]>([]);
  const [source, setSource] = useState<AaSource | "loading">("loading");

  useEffect(() => {
    let live = true;
    setSource("loading");
    void getOverdueTasks().then(({ data, source: s }) => {
      if (!live) return;
      setTasks(data);
      setSource(s);
    });
    return () => {
      live = false;
    };
  }, []);

  const isError = source === "error";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <StatGrid>
        <StatCard
          icon="🔴"
          iconBg="#fef2f2"
          label="Overdue tasks"
          value={source === "loading" ? "…" : isError ? "—" : tasks.length.toLocaleString("en-IN")}
        />
      </StatGrid>

      <div className="card">
        <div className="card-h">
          <h3>Overdue open tasks</h3>
          {isError ? <DataSourceBadge source="error" /> : null}
        </div>
        {source === "loading" ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>Loading overdue tasks…</p>
        ) : isError ? (
          <p role="alert" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>
            — Overdue tasks unavailable right now. <DataSourceBadge source="error" />
          </p>
        ) : tasks.length === 0 ? (
          <EmptyState icon="✅" title="Nothing overdue" message="No open tasks are past their due time." />
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Task</th><th>Due</th><th>Overdue by</th><th>Owner</th></tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.subjectType && t.subjectId ? (
                      <a href={`/crm/${t.subjectType === "account" ? "accounts" : "contacts"}/${t.subjectId}`}>{t.subject || "Task"}</a>
                    ) : (
                      t.subject || "Task"
                    )}
                  </td>
                  <td style={{ fontSize: 13 }}>{fmtDateTime(t.dueAt)}</td>
                  <td><span className="pill" style={{ background: "#fef2f2", color: "#b42318" }}>{formatAgeing(t.ageMinutes)}</span></td>
                  <td style={{ fontSize: 13 }}>{t.owner ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
