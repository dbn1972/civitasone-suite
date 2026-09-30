"use client";
/**
 * APARFlowCard / APARFlowList — Sprint 14 / Lifecycle Phase 2
 *
 * GAP-HR-APAR-01: this used to carry its own local `STAGES` array matching
 * a status vocabulary (initiated/pending/self_submitted, ro_review/…,
 * rv_submitted/…, accepted/disputed/closed) the backend never writes, so
 * every card's pipeline rendered "stage 1 active" regardless of the
 * record's real status. Stage data now comes from the shared
 * `@/lib/apar/stages` module, which is keyed on the seven statuses the
 * backend actually uses (self_pending … finalised) — see that module's
 * doc comment for the full history.
 *
 * GAP-HR-APAR-03: the deadline countdown (`deadlineMeta`, the `dl` badge)
 * is removed. `AparRecord.deadline` was never computed by the backend (no
 * `deadline` column on hrms_appraisals, nothing in apar/routes.ts sets one)
 * so this block never rendered for a single real record — see the decision
 * packet's "everything else" bucket: no per-stage deadline policy exists to
 * adopt, so the item's own stated safe default (delete the dead code
 * instead of inventing statutory due-dates) applies here.
 *
 * GAP-HR-APAR-05: stage labels now use DoPT/SPARROW terminology throughout
 * (Reporting Officer, Reviewing Officer, Accepting Authority) instead of
 * the old "Counter-signing Officer" / "Under Review" mix — see stages.ts.
 */
import { useTranslations } from "next-intl";
import { formatIndianDate } from "@/lib/formatters";
import { APAR_STAGE_GROUPS, stageIndex, isFinal, isRepresentationFiled } from "@/lib/apar/stages";

export type AparRecord = {
  id: string;
  employeeId?: string;
  employeeName?: string;
  appraisalPeriod: string;
  status: string;
  overallBand?: string | null;
  overallGrade?: string | null;
  updatedAt: string;
} & Record<string, unknown>;

function APARCard({ record }: { record: AparRecord }) {
  const t = useTranslations("aparFlowCard");
  const si = stageIndex(record.status);
  // GAP-HR-APAR-02 (deferred — see PR description): employeeName is not yet
  // populated by the backend, so this still falls back to the raw
  // employeeId. Left unchanged here deliberately; fixing it needs the
  // shared employee-name-enrichment helper tracked under GAP-HR-ADVANCES-01
  // (cross-lane, not yet dispatched).
  const empLabel = record.employeeName ?? record.employeeId ?? "Unknown";
  const isRepresentation = isRepresentationFiled(record.status);
  const isClosed = isFinal(record.status);

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
            insetInlineStart: "calc(50% / 5)", insetInlineEnd: "calc(50% / 5)",
            height: 2, background: "var(--line, #e2e8f0)", zIndex: 0,
          }}
        />

        {APAR_STAGE_GROUPS.map((group, i) => {
          const isDone = i < si || isClosed;
          const isActive = i === si && !isClosed;
          // The closure group (i === last) carries two attention states of
          // its own, distinct from the generic "active": representation
          // filed (needs HR to finalise) is flagged the same way "disputed"
          // used to be, rather than dropped silently (GAP-HR-APAR-05).
          const isAttention = isRepresentation && i === APAR_STAGE_GROUPS.length - 1;
          const stageState = isDone ? t("stateDone") : isActive ? t("stateActive") : t("statePending");

          return (
            <div
              key={group.key}
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
                  background: isAttention
                    ? "var(--warnbg, #fffbeb)"
                    : isDone
                    ? "var(--goodbg, #f0fdf4)"
                    : isActive
                    ? "var(--primary, #2563eb)"
                    : "var(--bg2, #f1f5f9)",
                  border: `2px solid ${
                    isAttention
                      ? "var(--warn, #b45309)"
                      : isDone
                      ? "var(--good, #16a34a)"
                      : isActive
                      ? "var(--primary, #2563eb)"
                      : "var(--line, #e2e8f0)"
                  }`,
                  color: isAttention
                    ? "var(--warn, #b45309)"
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
                aria-label={t("stageBubbleAriaLabel", { stage: t(group.labelKey), state: stageState })}
              >
                {isAttention ? "⚠" : isDone ? "✓" : group.icon}
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
                {t(group.labelKey)}
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
          <strong style={{ color: isRepresentation ? "var(--warn, #b45309)" : "var(--ink)" }}>
            {isRepresentation
              ? t("statusRepresentation")
              : isClosed
              ? t("statusFinalised")
              : t(APAR_STAGE_GROUPS[si].labelKey)}
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
