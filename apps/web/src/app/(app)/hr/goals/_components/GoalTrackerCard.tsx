"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/ds";

export type GoalStatus = "active" | "on_track" | "at_risk" | "behind" | "achieved" | "completed";
export type CascadeLevel = "org" | "dept" | "individual";

export interface GoalTrackerCardProps {
  id: string;
  title: string;
  description?: string;
  targetMetric?: string;
  progress: number;          // 0–100
  status: GoalStatus;
  category: string;
  dueDate?: string | null;
  cascadeLevel?: CascadeLevel;
  parentGoalTitle?: string;
  onCheckin?: (id: string, progress: number, note: string) => void;
  onEdit?: (id: string) => void;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  on_track:  { label: "On Track",  bg: "#e6f7f0", color: "var(--good, #15803d)" },
  active:    { label: "On Track",  bg: "#e6f7f0", color: "var(--good, #15803d)" },
  at_risk:   { label: "At Risk",   bg: "#fff7e6", color: "var(--warn, #d97706)" },
  behind:    { label: "Behind",    bg: "#fee2e2", color: "var(--bad, #dc2626)" },
  achieved:  { label: "Achieved",  bg: "var(--infobg, #eff6ff)", color: "var(--info, #1d4ed8)" },
  completed: { label: "Achieved",  bg: "var(--infobg, #eff6ff)", color: "var(--info, #1d4ed8)" },
};

const CASCADE_CONFIG: Record<CascadeLevel, { label: string; bg: string }> = {
  org:        { label: "Org",        bg: "var(--infobg, #e0e7ff)" },
  dept:       { label: "Dept",       bg: "var(--primary-soft, #fce7f3)" },
  individual: { label: "Individual", bg: "var(--goodbg, #f0fdf4)" },
};

function daysLeft(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

function DueDateChip({ dueDate }: { dueDate: string }) {
  const days = daysLeft(dueDate);
  const overdue  = days < 0;
  const urgent   = days >= 0 && days <= 7;
  const bg    = overdue ? "var(--badbg, #fee2e2)" : urgent ? "#fff7e6" : "var(--bg, #f1f5f9)";
  const color = overdue ? "var(--bad, #dc2626)" : urgent ? "var(--warn, #d97706)" : "#475569";
  const label = overdue
    ? `${Math.abs(days)}d overdue`
    : days === 0
    ? "Due today"
    : `${days}d left`;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, background: bg, color, borderRadius: 4, padding: "2px 6px" }}>
      {label}
    </span>
  );
}

export function GoalTrackerCard({
  id, title, description, targetMetric, progress, status,
  category, dueDate, cascadeLevel = "individual", parentGoalTitle, onCheckin, onEdit,
}: GoalTrackerCardProps) {
  const t = useTranslations("goals");
  const tAction = useTranslations("action");
  const router = useRouter();
  const [showCheckin, setShowCheckin] = useState(false);
  const [checkinProgress, setCheckinProgress] = useState(progress);
  const [checkinNote, setCheckinNote] = useState("");
  // GAP-HR-GOALS-01: optimistic local view of what the server now holds,
  // updated only after a real successful check-in (see handleCheckin) --
  // distinct from `checkinProgress`/`checkinNote`, which are just the
  // in-progress edit form's own draft values.
  const [liveProgress, setLiveProgress] = useState(progress);
  const [liveStatus, setLiveStatus] = useState<GoalStatus>(status);
  const [busy, setBusy] = useState(false);
  const [checkinError, setCheckinError] = useState("");

  const sc  = STATUS_CONFIG[liveStatus] ?? STATUS_CONFIG.active;
  const cc  = CASCADE_CONFIG[cascadeLevel];
  const pct = Math.min(Math.max(liveProgress, 0), 100);

  const trackColor = sc.color;

  /**
   * GAP-HR-GOALS-01: Save used to only call the optional `onCheckin` prop
   * (`onCheckin?.(...)`) -- goals/page.tsx (a Server Component) never passed
   * one, so clicking Save silently closed the form with no request, no
   * confirmation, and no persisted change; POST /v1/hrms/goals/:id/checkin
   * (services/hrms-service/.../pulse-routes.ts) was never reached from the
   * UI at all.
   *
   * `onCheckin`, when a caller supplies it, is kept as an override/test seam
   * (see GoalTrackerCard.test.tsx, whose four existing cases all pass one and
   * assert it is called instead of any network request) so that suite's
   * existing expectations are unchanged. The real production caller
   * (goals/page.tsx) passes none, so this component now performs the request
   * itself: integer 0-100 progress (native `<input type=number min=0 max=100>`
   * plus the `Math.min/Math.max` clamp on `pct` already keep it in range;
   * the backend's own zod schema is the authority), a busy/disabled state
   * while in flight, and an inline error that keeps the form open on failure
   * rather than closing on a request that never actually saved anything.
   */
  async function handleCheckin() {
    if (onCheckin) {
      onCheckin(id, checkinProgress, checkinNote);
      setShowCheckin(false);
      setCheckinNote("");
      return;
    }

    setBusy(true);
    setCheckinError("");
    try {
      const res = await fetch(`/api/proxy/v1/hrms/goals/${id}/checkin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          progress: checkinProgress,
          note: checkinNote.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: t("checkinSaveFailed") }))) as { message?: string };
        setCheckinError(err.message ?? t("checkinSaveFailed"));
        setBusy(false);
        return;
      }
      // Mirrors the backend's own status derivation exactly (pulse-routes.ts:
      // `progress >= 100 ? "completed" : "active"`) so the card reflects the
      // real post-write state without waiting on the parent list to refetch.
      setLiveProgress(checkinProgress);
      setLiveStatus(checkinProgress >= 100 ? "completed" : "active");
      setShowCheckin(false);
      setCheckinNote("");
      setBusy(false);
      router.refresh();
    } catch {
      setCheckinError(t("networkError"));
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--line, #e2e8f0)",
        borderRadius: 10,
        background: "var(--panel, #fff)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Cascade breadcrumb */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4, flexWrap: "wrap" }}>
            {cascadeLevel !== "org" && (
              <>
                <span style={{ fontSize: 11, color: "var(--mut)" }}>Org</span>
                <span style={{ fontSize: 11, color: "var(--line, #cbd5e1)" }}>→</span>
              </>
            )}
            {cascadeLevel === "individual" && (
              <>
                <span style={{ fontSize: 11, color: "var(--mut)" }}>Dept</span>
                <span style={{ fontSize: 11, color: "var(--line, #cbd5e1)" }}>→</span>
              </>
            )}
            <span style={{ fontSize: 11, fontWeight: 600, background: cc.bg, borderRadius: 4, padding: "1px 5px" }}>
              {cc.label}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 500, background: "var(--bg, #f1f5f9)", color: "var(--ink2, #475569)",
              borderRadius: 4, padding: "1px 5px", marginInlineStart: 2,
            }}>{category}</span>
          </div>

          <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: "var(--ink, #1e293b)", lineHeight: 1.3 }}>
            {title}
          </p>
          {description && (
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--mut, #64748b)", lineHeight: 1.4 }}>{description}</p>
          )}
          {parentGoalTitle && (
            <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--mut)" }}>
              Cascaded from: <em>{parentGoalTitle}</em>
            </p>
          )}
        </div>
        {/* Status badge */}
        <span style={{
          flexShrink: 0, fontSize: 11, fontWeight: 700, background: sc.bg, color: sc.color,
          borderRadius: 20, padding: "3px 8px", textTransform: "uppercase", letterSpacing: "0.05em",
        }}>
          {sc.label}
        </span>
      </div>

      {/* Target metric */}
      {targetMetric && (
        <div style={{ fontSize: 12, color: "var(--ink2, #475569)" }}>
          <span style={{ fontWeight: 600, color: "var(--ink, #1e293b)" }}>{t("targetLabel")}</span> {targetMetric}
        </div>
      )}

      {/* Progress bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: "var(--mut, #64748b)" }}>{t("progressLabel")}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: trackColor }}>{pct}%</span>
        </div>
        <div style={{ height: 6, background: "var(--line, #e2e8f0)", borderRadius: 99, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: trackColor,
              borderRadius: 99,
              transition: "width 0.4s ease",
            }}
          />
        </div>
      </div>

      {/* Footer: due date + actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        <div>{dueDate && <DueDateChip dueDate={dueDate} />}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {onEdit && (
            <Button variant="ghost" size="sm" onClick={() => onEdit(id)}>
              {t("editButton")}
            </Button>
          )}
          <Button size="sm" onClick={() => setShowCheckin(!showCheckin)}>
            {t("checkinButton")}
          </Button>
        </div>
      </div>

      {/* Inline check-in form */}
      {showCheckin && (
        <div
          style={{
            marginTop: 4, padding: 10, background: "var(--bg, #f8fafc)", borderRadius: 8,
            border: "1px solid var(--line, #e2e8f0)", display: "flex", flexDirection: "column", gap: 8,
          }}
        >
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink, #1e293b)" }}>
            {t("newProgressLabel")}
            <input
              type="number" min={0} max={100}
              value={checkinProgress}
              disabled={busy}
              onChange={(e) => setCheckinProgress(Number(e.target.value))}
              style={{
                display: "block", width: "100%", marginTop: 4, padding: "5px 8px",
                border: "1px solid var(--line, #cbd5e1)", borderRadius: 6, fontSize: 13,
              }}
            />
          </label>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink, #1e293b)" }}>
            {t("noteLabel")}
            <textarea
              rows={2}
              value={checkinNote}
              disabled={busy}
              onChange={(e) => setCheckinNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              style={{
                display: "block", width: "100%", marginTop: 4, padding: "5px 8px",
                border: "1px solid var(--line, #cbd5e1)", borderRadius: 6, fontSize: 13, resize: "vertical",
                boxSizing: "border-box",
              }}
            />
          </label>
          {checkinError && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--bad, #dc2626)" }}>{checkinError}</p>
          )}
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setShowCheckin(false); setCheckinError(""); }}>
              {tAction("cancel")}
            </Button>
            <Button size="sm" disabled={busy} onClick={handleCheckin}>
              {busy ? t("savingLabel") : tAction("save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
