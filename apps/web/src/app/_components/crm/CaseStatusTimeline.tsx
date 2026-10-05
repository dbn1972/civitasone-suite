"use client";
import { useTranslations } from "next-intl";
import { Card, StatusPill } from "../ds";

/**
 * F6-01 — a status-transition timeline card for case-like resources (service
 * requests, RTI). Presentational only: the detail page fetches the ordered
 * history (oldest first) from GET .../:id/history and passes it in. Rendered
 * newest-first here for a familiar top-of-list reading order.
 */
export interface CaseHistoryEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  actorId: string;
  at: string;
}

function fmt(dt: string): string {
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function CaseStatusTimeline({
  entries,
  title,
}: {
  entries: CaseHistoryEntry[];
  title?: string;
}) {
  const t = useTranslations("crmTimeline");
  const heading = title ?? t("title");
  if (!Array.isArray(entries) || entries.length === 0) {
    return (
      <Card title={heading}>
        <p style={{ margin: "12px 16px", fontSize: 13, color: "var(--ink2)" }}>
          {t("empty")}
        </p>
      </Card>
    );
  }
  const ordered = [...entries].reverse();
  return (
    <Card title={heading}>
      <ol style={{ listStyle: "none", margin: "12px 16px", padding: 0, display: "grid", gap: 12 }}>
        {ordered.map((e) => (
          <li
            key={e.id}
            style={{ display: "grid", gap: 4, borderInlineStart: "2px solid var(--line)", paddingInlineStart: 12 }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {e.fromStatus ? (
                <>
                  <StatusPill status={e.fromStatus} />
                  <span aria-hidden style={{ color: "var(--ink2)" }}>→</span>
                </>
              ) : (
                <span style={{ fontSize: 12, color: "var(--ink2)" }}>{t("opened")}</span>
              )}
              <StatusPill status={e.toStatus} />
              <span style={{ fontSize: 12, color: "var(--ink2)", marginInlineStart: "auto" }}>{fmt(e.at)}</span>
            </div>
            {e.note ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--ink)", whiteSpace: "pre-wrap" }}>{e.note}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}
