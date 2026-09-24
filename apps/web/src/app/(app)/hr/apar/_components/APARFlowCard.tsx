"use client";
/**
 * APARFlowCard / APARFlowList — Sprint 14 / Lifecycle Phase 2
 * SPARROW-style 4-stage APAR pipeline:
 * Self-Appraisal → Reporting Officer → Counter-signing Officer → Acceptance / Dispute.
 * Active stage highlighted, deadline countdown shown on each card.
 */
import { useTranslations } from "next-intl";
import { formatIndianDate } from "@/lib/formatters";

export type AparRecord = {
  id: string;
  employeeId?: string;
  employeeName?: string;
  appraisalPeriod: string;
  status: string;
  overallBand?: string | null;
  overallGrade?: string | null;
  deadline?: string | null;
  updatedAt: string;
} & Record<string, unknown>;

interface Stage {
  key: string;
  labelKey: string;
  icon: string;
  matchStatuses: string[];
}

// UX-017: display labels are looked up through t(stage.labelKey) at render
// time (see APARCard below) so the pipeline stays in the active locale;
// this array only carries structural/lookup data.
const STAGES: Stage[] = [
  {
    key: "self",
    labelKey: "stageSelf",
    icon: "✍️",
    matchStatuses: ["initiated", "pending", "self_submitted"],
  },
  {
    key: "ro",
    labelKey: "stageRo",
    icon: "📋",
    matchStatuses: ["ro_review", "ro_submitted"],
  },
  {
    key: "cso",
    labelKey: "stageCso",
    icon: "🔍",
    matchStatuses: ["rv_submitted", "under_review", "cso_review"],
  },
  {
    key: "accept",
    labelKey: "stageAccept",
    icon: "✅",
    matchStatuses: ["accepted", "disputed", "closed"],
  },
];

function stageIndex(status: string): number {
  for (let i = 0; i < STAGES.length; i++) {
    if (STAGES[i].matchStatuses.includes(status)) return i;
  }
  return 0;
}

type Translate = ReturnType<typeof useTranslations>;

function deadlineMeta(
  dl: string | null | undefined,
  t: Translate,
): { text: string; color: string } | null {
  if (!dl) return null;
  const days = Math.ceil((new Date(dl).getTime() - Date.now()) / 86_400_000);
  if (days < 0)  return { text: t("overdueDays", { days: Math.abs(days) }), color: "var(--bad, #dc2626)" };
  if (days === 0) return { text: t("dueToday"),                            color: "var(--bad, #dc2626)" };
  if (days <= 7)  return { text: t("daysLeft", { days }),                  color: "var(--warn, #b45309)" };
  return { text: t("daysLeft", { days }),                                  color: "var(--info, #2563eb)" };
}

function APARCard({ record }: { record: AparRecord }) {
  const t          = useTranslations("aparFlowCard");
  const si         = stageIndex(record.status);
  const dl         = deadlineMeta(record.deadline, t);
  const empLabel   = record.employeeName ?? record.employeeId ?? "Unknown";
  const isDisputed = record.status === "disputed";
  const isClosed   = record.status === "closed" || record.status === "accepted";

  return (
    <article
      className="card"
      style={{ marginBottom: 0 }}
      aria-label={t("cardAriaLabel", { name: empLabel, period: record.appraisalPeriod })}
    >
      {/* Header */}
      <div className="card-h" style={{ alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>{empLabel}</h3>
          <p style={{ margin: "2px 0 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>
            {t("periodPrefix")} <strong>{record.appraisalPeriod}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          {record.overallBand && (
            <span
              style={{
                padding: "2px 10px", borderRadius: 12,
                background: "var(--infobg, #e6f0ff)", color: "var(--info, #1d4ed8)",
                fontSize: "0.75rem", fontWeight: 700,
              }}
            >
              {t("bandPrefix", { band: record.overallBand })}
            </span>
          )}
          {dl && (
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: dl.color }}>
              ⏰ {dl.text}
            </span>
          )}
        </div>
      </div>

      {/* Stage pipeline */}
      <div
        style={{
          display: "flex", alignItems: "flex-start",
          margin: "16px 16px 14px",
          position: "relative",
        }}
        role="list"
        aria-label={t("stagesAriaLabel")}
      >
        {/* Connector line */}
        <div
          aria-hidden
          style={{
            position: "absolute", top: 16,
            insetInlineStart: "calc(50% / 4)", insetInlineEnd: "calc(50% / 4)",
            height: 2, background: "var(--line, #e2e8f0)", zIndex: 0,
          }}
        />

        {STAGES.map((stage, i) => {
          const isDone    = i < si || isClosed;
          const isActive  = i === si && !isClosed;
          const isDisp    = isDisputed && i === STAGES.length - 1;
          const stageState = isDone ? t("stateDone") : isActive ? t("stateActive") : t("statePending");

          return (
            <div
              key={stage.key}
              role="listitem"
              style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", gap: 6,
                position: "relative", zIndex: 1,
              }}
            >
              {/* Bubble */}
              <div
                style={{
                  width: 34, height: 34, borderRadius: "50%",
                  background: isDisp
                    ? "var(--badbg, #fef2f2)"
                    : isDone
                    ? "var(--goodbg, #f0fdf4)"
                    : isActive
                    ? "var(--primary, #2563eb)"
                    : "var(--bg2, #f1f5f9)",
                  border: `2px solid ${
                    isDisp
                      ? "var(--bad, #dc2626)"
                      : isDone
                      ? "var(--good, #16a34a)"
                      : isActive
                      ? "var(--primary, #2563eb)"
                      : "var(--line, #e2e8f0)"
                  }`,
                  color: isDisp
                    ? "var(--bad, #dc2626)"
                    : isDone
                    ? "var(--good, #16a34a)"
                    : isActive
                    ? "var(--panel, #fff)"
                    : "var(--mut)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 15,
                  boxShadow: isActive ? "0 0 0 4px var(--infobg, #dbeafe)" : "none",
                  transition: "all 0.2s",
                }}
                aria-label={t("stageBubbleAriaLabel", { stage: t(stage.labelKey), state: stageState })}
              >
                {isDisp ? "⚠" : isDone ? "✓" : stage.icon}
              </div>

              {/* Stage label */}
              <span
                style={{
                  fontSize: "0.625rem", textAlign: "center", lineHeight: 1.3,
                  color: isActive
                    ? "var(--primary, #1d4ed8)"
                    : isDone
                    ? "var(--good, #16a34a)"
                    : "var(--mut)",
                  fontWeight: isActive ? 600 : 400,
                  maxWidth: 66,
                }}
              >
                {t(stage.labelKey)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "8px 16px 12px",
          borderTop: "1px solid var(--line, #e2e8f0)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: "0.75rem", color: "var(--mut)",
        }}
      >
        <span>
          {t("stagePrefix")}&nbsp;
          <strong style={{ color: isDisputed ? "var(--bad, #dc2626)" : "var(--ink)" }}>
            {isDisputed
              ? t("statusDisputed")
              : isClosed
              ? t("statusClosed")
              : (STAGES[si] ? t(STAGES[si].labelKey) : record.status)}
          </strong>
        </span>
        <span>{t("updatedPrefix", { date: formatIndianDate(record.updatedAt) })}</span>
      </div>
    </article>
  );
}

interface ListProps { records: AparRecord[] }

export function APARFlowList({ records }: ListProps) {
  const t = useTranslations("aparFlowCard");
  if (records.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--mut)" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
        <p style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 500 }}>
          {t("emptyText")}
        </p>
      </div>
    );
  }
  return (
    <div
      style={{
        display: "grid", gap: 12,
        gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))",
      }}
    >
      {records.map((r) => (
        <APARCard key={r.id} record={r} />
      ))}
    </div>
  );
}
