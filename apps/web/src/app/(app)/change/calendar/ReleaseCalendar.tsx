import { freezesConflictingWith } from "../_data/calendar";
import type { ChangeFreeze, ChangeRequest } from "../_data/types";
import { formatIndianDateTime } from "@/lib/formatters";

/**
 * GAP-CHANGE-CALENDAR-01: an agenda-style release calendar. The page is named
 * "calendar" but previously showed two flat tables with no way to SEE a window
 * that collides with a freeze (the collision is only enforced server-side at
 * schedule time). This plots scheduled release windows and change freezes as
 * distinct bands on a single chronological agenda, and flags any window that
 * overlaps a freeze with a "Conflicts with freeze …" pill, so a conflict is
 * visible before anyone attempts to schedule. The server (admin-service
 * assertNoFreezeConflict) remains authoritative for actually blocking.
 *
 * Server Component (no interactivity); the DataTable tables below it on the
 * page remain as the accessible, sortable fallback.
 */
type AgendaItem =
  | { kind: "window"; at: number; change: ChangeRequest; conflicts: ChangeFreeze[] }
  | { kind: "freeze"; at: number; freeze: ChangeFreeze };

export function ReleaseCalendar({
  scheduled,
  freezes,
}: {
  scheduled: readonly ChangeRequest[];
  freezes: readonly ChangeFreeze[];
}) {
  const items: AgendaItem[] = [
    ...scheduled.map((c) => ({
      kind: "window" as const,
      at: c.windowStart ? Date.parse(c.windowStart) : 0,
      change: c,
      conflicts: freezesConflictingWith(c, freezes),
    })),
    ...freezes.map((f) => ({
      kind: "freeze" as const,
      at: Date.parse(f.startsAt),
      freeze: f,
    })),
  ].sort((a, b) => a.at - b.at);

  if (items.length === 0) return null;

  return (
    <div className="card">
      <div className="card-h"><h3>Agenda</h3></div>
      <ol className="pad" style={{ listStyle: "none", margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item) => {
          if (item.kind === "freeze") {
            const f = item.freeze;
            return (
              <li key={`f-${f.id}`} style={{ borderLeft: "4px solid var(--infobg, #3b82f6)", paddingLeft: 12 }}>
                <strong>🧊 Freeze: {f.name}</strong>
                <div style={{ color: "#667085", fontSize: 13 }}>
                  {formatIndianDateTime(f.startsAt)} → {formatIndianDateTime(f.endsAt)} · {f.reason}
                </div>
              </li>
            );
          }
          const c = item.change;
          const hasConflict = item.conflicts.length > 0;
          return (
            <li
              key={`w-${c.id}`}
              style={{ borderLeft: `4px solid ${hasConflict ? "var(--badbg, #ef4444)" : "var(--goodbg, #22c55e)"}`, paddingLeft: 12 }}
            >
              <strong>🗓️ <a href={`/change/${c.id}`}>{c.title}</a></strong>
              <div style={{ color: "#667085", fontSize: 13 }}>
                {c.windowStart ? formatIndianDateTime(c.windowStart) : "—"} → {c.windowEnd ? formatIndianDateTime(c.windowEnd) : "—"}
              </div>
              {hasConflict && (
                <div role="alert" style={{ marginTop: 4 }}>
                  {item.conflicts.map((f) => (
                    <span key={f.id} className="pill bad" style={{ marginRight: 6 }}>
                      Conflicts with freeze “{f.name}”
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
