import type { StageEntry } from "./fetchApplication";
import { formatIndianDate, formatIndianDateTime } from "@/lib/formatters";

/** Small text colour with >= 4.5:1 contrast on white (the old #94a3b8 was ~2.6:1). */
const MUTED = "#5b6b80";
const DONE = "#047857";
const ACTIVE = "#b45309";
const ENDED = "#b91c1c";
const FUTURE_RING = "#94a3b8";

export type StageTimelineLabels = {
  completed: string;
  current: string;
  upcoming: string;
  ended: string;
  inProgress: string;
  venue: string;
  joinLink: string;
  minutes: (n: number) => string;
  mode: (mode: string) => string;
};

const SR_ONLY: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
  overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0,
};

/**
 * Candidate application journey as an ordered list (GAP-...-APPLICATION-DETAIL-07): list semantics,
 * aria-current="step" on the active step, completed / current / upcoming announced as text, and
 * state shown by glyph + ring style as well as colour. Dates render in IST and an unknown or
 * unparsable timestamp renders nothing (never "Invalid Date").
 */
export function StageTimeline({ timeline, labels }: { timeline: StageEntry[]; labels: StageTimelineLabels }) {
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, paddingInlineStart: 28, position: "relative" }}>
      <li role="presentation" aria-hidden="true" style={{ position: "absolute", insetInlineStart: 7, top: 6, width: 2, bottom: 6, background: "#e2e8f0", listStyle: "none" }} />
      {timeline.map((s, i) => {
        const isLast = i === timeline.length - 1;
        const color = s.status === "done" ? DONE : s.status === "active" ? ACTIVE : s.status === "ended" ? ENDED : "#fff";
        const stateText = s.status === "done" ? labels.completed : s.status === "active" ? labels.current : s.status === "ended" ? labels.ended : labels.upcoming;
        const when = s.interview ? formatIndianDateTime(s.interview.at) : s.note ? formatIndianDate(s.note) : "";
        const hasWhen = when !== "" && when !== "—" && !Number.isNaN(new Date(s.interview?.at ?? s.note ?? "").getTime());
        return (
          <li
            key={s.stage}
            aria-current={s.status === "active" ? "step" : undefined}
            style={{ position: "relative", marginBottom: isLast ? 0 : 20 }}
          >
            {!isLast && s.status === "done" && (
              <span aria-hidden="true" style={{ position: "absolute", insetInlineStart: -21, top: 14, width: 2, height: "calc(100% + 6px)", background: DONE }} />
            )}
            <span
              aria-hidden="true"
              style={{
                position: "absolute", insetInlineStart: -24, top: 3, width: 14, height: 14, borderRadius: "50%",
                background: color, border: s.status === "future" ? `2px solid ${FUTURE_RING}` : "2px solid #fff",
                boxShadow: s.status === "active" ? "0 0 0 4px rgba(180,83,9,0.2)" : "none",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {s.status === "done" && <span style={{ fontSize: 8, color: "#fff", fontWeight: 800 }}>✓</span>}
              {s.status === "ended" && <span style={{ fontSize: 8, color: "#fff", fontWeight: 800 }}>✕</span>}
              {s.status === "active" && <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#fff" }} />}
            </span>
            <div style={{ fontSize: 14, fontWeight: 600, color: s.status === "future" ? MUTED : "#0f172a" }}>
              {s.label}
              <span style={SR_ONLY}> ({stateText})</span>
            </div>
            {hasWhen && <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{when}</div>}
            {s.interview && (
              <div data-testid="interview-detail" style={{ fontSize: 12, color: "#334155", marginTop: 2 }}>
                <div>{labels.mode(s.interview.mode)} · {labels.minutes(s.interview.durationMinutes)}</div>
                {s.interview.venue && <div>{labels.venue}: {s.interview.venue}</div>}
                {s.interview.meetingLink && (
                  <div><a href={s.interview.meetingLink} rel="noopener noreferrer" style={{ color: "#154089", textDecoration: "underline" }}>{labels.joinLink}</a></div>
                )}
              </div>
            )}
            {s.status === "active" && (
              <div style={{ marginTop: 6, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: MUTED }}>
                {labels.inProgress}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
