"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface CalendarMeeting {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  scheduledDate: string;
  scheduledTime?: string;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKeyOf(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function shiftMonth(c: { year: number; month: number }, delta: number): { year: number; month: number } {
  const m = c.month + delta;
  const year = c.year + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  return { year, month };
}

/**
 * A real (if simple) month-grid calendar — grouping meetings already fetched
 * for the list page by `scheduledDate`, no extra API call. This is what the
 * "Calendar" toggle on /estab/meetings now actually switches to, instead of
 * silently re-rendering the same table.
 */
export function MeetingsCalendar({ meetings }: { meetings: CalendarMeeting[] }) {
  const todayCursor = useMemo(() => {
    const t = new Date();
    return { year: t.getFullYear(), month: t.getMonth() };
  }, []);

  // Default to the soonest upcoming meeting's month when there is one, so a
  // secretariat opening this view actually sees something without clicking
  // "Next" — otherwise fall back to the current month.
  const initialCursor = useMemo(() => {
    const today = new Date(todayCursor.year, todayCursor.month, 1);
    let soonest: Date | null = null;
    for (const m of meetings) {
      const d = new Date(m.scheduledDate);
      if (Number.isNaN(d.getTime())) continue;
      if (d >= today && (soonest === null || d < soonest)) soonest = d;
    }
    return soonest ? { year: soonest.getFullYear(), month: soonest.getMonth() } : todayCursor;
  }, [meetings, todayCursor]);

  const [cursor, setCursor] = useState(initialCursor);

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarMeeting[]>();
    for (const m of meetings) {
      const list = map.get(m.scheduledDate) ?? [];
      list.push(m);
      map.set(m.scheduledDate, list);
    }
    return map;
  }, [meetings]);

  const firstOfMonth = new Date(cursor.year, cursor.month, 1);
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const startWeekday = firstOfMonth.getDay();
  const monthLabel = firstOfMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const todayKey = dateKeyOf(todayCursor.year, todayCursor.month, new Date().getDate());

  const cells: (number | null)[] = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div style={{ padding: 4 }}>
      <div className="card-h">
        <h3>{monthLabel}</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn ghost sm" onClick={() => setCursor((c) => shiftMonth(c, -1))}>
            ← Prev
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setCursor(todayCursor)}>
            Today
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setCursor((c) => shiftMonth(c, 1))}>
            Next →
          </button>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 6,
          marginTop: 10,
        }}
      >
        {WEEKDAY_LABELS.map((d) => (
          <div
            key={d}
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--ink2)",
              textAlign: "center",
              padding: "4px 0",
            }}
          >
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} />;
          const key = dateKeyOf(cursor.year, cursor.month, day);
          const dayMeetings = byDate.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              style={{
                minHeight: 84,
                border: `1px solid ${isToday ? "var(--primary)" : "var(--line)"}`,
                borderRadius: 8,
                padding: 6,
                background: dayMeetings.length > 0 ? "var(--line2)" : "transparent",
              }}
            >
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: isToday ? 800 : 600,
                  color: isToday ? "var(--primary)" : "var(--ink2)",
                }}
              >
                {day}
              </div>
              <div style={{ display: "grid", gap: 3, marginTop: 4 }}>
                {dayMeetings.slice(0, 3).map((m) => (
                  <Link
                    key={m.id}
                    href={`/estab/meetings/${m.id}`}
                    title={`${m.title}${m.scheduledTime ? " · " + m.scheduledTime : ""}`}
                    style={{
                      fontSize: 11,
                      padding: "2px 5px",
                      borderRadius: 5,
                      background: "var(--primary-soft)",
                      color: "var(--primary-d)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      display: "block",
                    }}
                  >
                    {m.scheduledTime ? `${m.scheduledTime} · ` : ""}
                    {m.title}
                  </Link>
                ))}
                {dayMeetings.length > 3 && (
                  <span style={{ fontSize: 10.5, color: "var(--ink2)" }}>
                    +{dayMeetings.length - 3} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
