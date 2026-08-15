/**
 * LifecycleTimeline — Sprint 13 / Lifecycle Phase 1
 * Vertical timeline of all lifecycle events on the employee profile.
 * Events: join, transfer, promotion, deputation, confirmation.
 * Pure display component — no client state needed.
 */

import { formatIndianDate } from "@/lib/formatters";

export type LifecycleEvent = {
  id: string;
  type: "join" | "transfer" | "promotion" | "deputation" | "confirmation" | "separation" | "other";
  date: string;
  title: string;
  detail?: string;
  status?: string;
};

const EVENT_CONFIG: Record<LifecycleEvent["type"], { icon: string; color: string; bg: string }> = {
  join:         { icon: "🎉", color: "#16a34a", bg: "#f0fdf4" },
  transfer:     { icon: "🔄", color: "#2563eb", bg: "#eff6ff" },
  promotion:    { icon: "⬆️", color: "#7c3aed", bg: "#f5f3ff" },
  deputation:   { icon: "🏛️", color: "#0891b2", bg: "#ecfeff" },
  confirmation: { icon: "✅", color: "#16a34a", bg: "#f0fdf4" },
  separation:   { icon: "📤", color: "#dc2626", bg: "#fef2f2" },
  other:        { icon: "📌", color: "#64748b", bg: "#f8fafc" },
};

interface Props {
  events: LifecycleEvent[];
}

export function LifecycleTimeline({ events }: Props) {
  if (events.length === 0) {
    return (
      <div style={{ padding: "24px 20px", textAlign: "center", color: "var(--ink3)" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
        <p style={{ margin: 0, fontSize: "0.875rem" }}>No lifecycle events recorded yet.</p>
      </div>
    );
  }

  // Sort chronologically (oldest first)
  const sorted = [...events].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <ol
      aria-label="Employee lifecycle timeline"
      style={{ listStyle: "none", margin: 0, padding: "8px 16px 8px 0", position: "relative" }}
    >
      {/* Vertical line */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 20,
          top: 20,
          bottom: 20,
          width: 2,
          background: "var(--line, #e2e8f0)",
          borderRadius: 2,
        }}
      />
      {sorted.map((event, i) => {
        const cfg = EVENT_CONFIG[event.type];
        const isLast = i === sorted.length - 1;
        return (
          <li
            key={event.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 14,
              paddingLeft: 8,
              marginBottom: isLast ? 0 : 24,
              position: "relative",
            }}
          >
            {/* Icon bubble */}
            <div
              aria-hidden
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: cfg.bg,
                border: `2px solid ${cfg.color}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                flexShrink: 0,
                position: "relative",
                zIndex: 1,
              }}
            >
              {cfg.icon}
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0, paddingTop: 6 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    color: cfg.color,
                  }}
                >
                  {event.title}
                </span>
                {event.status && (
                  <span style={{
                    fontSize: "0.6875rem",
                    padding: "2px 8px",
                    borderRadius: 10,
                    background: cfg.bg,
                    color: cfg.color,
                    border: `1px solid ${cfg.color}`,
                    fontWeight: 600,
                  }}>
                    {event.status}
                  </span>
                )}
                <span style={{ fontSize: "0.75rem", color: "var(--ink3)", marginLeft: "auto" }}>
                  {formatIndianDate(event.date)}
                </span>
              </div>
              {event.detail && (
                <p style={{ margin: "4px 0 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>
                  {event.detail}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
