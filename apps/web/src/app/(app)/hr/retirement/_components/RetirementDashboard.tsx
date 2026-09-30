"use client";
/**
 * RetirementDashboard — Sprint 14 / Lifecycle Phase 2
 * Card grid of employees retiring in the next 6 months (plus an overdue
 * group), sorted by date ascending. Each card: name, designation,
 * retirement date, years of service.
 */
import { useTranslations } from "next-intl";
import { StatusPill, Button } from "@/app/_components/ds";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import { isUpcoming, isOverdue, sortByDateAsc, todayDateOnly, SEPARATION_TYPES } from "@/lib/retirement";

export type RetirementRow = {
  id: string;
  employee: string;
  designation?: string;
  department?: string;
  superannuationDate: string;
  separationType?: string;
  joiningDate?: string;
  yearsOfService?: number;
  status: string;
} & Record<string, unknown>;

function calcYOS(row: RetirementRow): number {
  if (row.yearsOfService) return Number(row.yearsOfService);
  if (row.joiningDate) {
    const ms = new Date(row.superannuationDate).getTime() - new Date(row.joiningDate).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25));
  }
  return 0;
}

function daysLeft(iso: string): number {
  // GAP-HR-RETIREMENT-05: date-only difference (not a full Date-with-time
  // subtraction), so "today" is consistently 0, not a fraction that floors
  // to -1 late in the day.
  const today = new Date(`${todayDateOnly()}T00:00:00Z`).getTime();
  const target = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((target - today) / 86_400_000);
}

type Translator = ReturnType<typeof useTranslations>;

/**
 * GAP-HR-RETIREMENT-04: was the raw lowercase enum ("vrs", "retirement") in
 * both the register and this card -- proper labels already exist
 * (initiateSeparation.separationType_*); an unrecognised value humanizes
 * instead of showing raw text or crashing next-intl on a missing key.
 */
function typeLabel(separationType: string | undefined, t: Translator, tType: Translator): string {
  if (!separationType) return t("typeSuperannuation");
  const key = separationType.toLowerCase();
  if ((SEPARATION_TYPES as readonly string[]).includes(key)) {
    return tType(`separationType_${key}`);
  }
  return humanizeStatus(separationType);
}

function borderColor(days: number): string {
  if (days < 0) return "var(--bad, #dc2626)";
  if (days <= 30) return "var(--bad, #dc2626)";
  if (days <= 90) return "var(--warn, #f59e0b)";
  return "var(--info, #2563eb)";
}

interface Props {
  rows: RetirementRow[];
  /** Currently selected retiree (for the processing wizard below), if any. */
  selectedId?: string;
  /** Called when the officer picks a retiree to process. */
  onSelect?: (row: RetirementRow) => void;
}

export function RetirementDashboard({ rows, selectedId, onSelect }: Props) {
  const t = useTranslations("retirementDashboard");
  // GAP-HR-RETIREMENT-04: reuses the labels InitiateSeparationAction.tsx
  // already defines (initiateSeparation.separationType_*) instead of a
  // second, parallel copy of the same five translations.
  const tType = useTranslations("initiateSeparation");
  const upcoming = sortByDateAsc(rows.filter((r) => isUpcoming(r)));
  // GAP-HR-RETIREMENT-05: a separation whose effective date has passed but
  // whose status is still "initiated" (nothing currently advances it, see
  // GAP-HR-RETIREMENT-03) previously vanished from this dashboard the
  // moment "upcoming" stopped matching it -- visible only in the full
  // register below, easy to lose track of.
  const overdue = sortByDateAsc(rows.filter((r) => isOverdue(r)));
  const combined = [...overdue, ...upcoming];

  if (combined.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--mut)" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden="true">👴</div>
        <p style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 500 }}>{t("noUpcomingTitle")}</p>
        <p style={{ margin: "4px 0 0", fontSize: "0.8125rem", color: "var(--mut)" }}>{t("noUpcomingMessage")}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))" }}>
      {combined.map((row) => {
        const days = daysLeft(row.superannuationDate);
        const overdueRow = days < 0;
        const yos = calcYOS(row);
        const selected = row.id === selectedId;
        return (
          <article
            key={row.id}
            className="card"
            style={{
              marginBottom: 0,
              borderInlineStart: `4px solid ${borderColor(days)}`,
              outline: selected ? "2px solid var(--primary, #2563eb)" : "none",
              outlineOffset: -1,
            }}
            aria-label={t("cardAriaLabel", { name: row.employee })}
            aria-current={selected ? "true" : undefined}
          >
            <div className="card-h" style={{ alignItems: "flex-start", gap: 10 }}>
              <div
                aria-hidden="true"
                style={{
                  width: 42, height: 42, borderRadius: "50%",
                  background: "var(--infobg, #e6f0ff)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 20, flexShrink: 0,
                }}
              >
                👴
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>{row.employee}</h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>
                  {row.designation ?? "—"}
                  {row.department ? ` · ${row.department}` : ""}
                </p>
              </div>
              <StatusPill status={row.status} />
            </div>

            {overdueRow && (
              <div style={{ margin: "10px 16px 0", padding: "6px 10px", borderRadius: 6, background: "var(--badbg, #fef2f2)", fontSize: "0.75rem", fontWeight: 600, color: "var(--bad, #dc2626)" }}>
                {t("overdueLabel")}
              </div>
            )}

            <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", margin: "12px 16px 0", padding: 0, fontSize: "0.8125rem" }}>
              <div>
                <dt style={{ color: "var(--mut)", marginBottom: 2 }}>{t("colRetirementDate")}</dt>
                <dd style={{ margin: 0, fontWeight: 600, color: days <= 30 ? "var(--bad, #dc2626)" : "var(--ink)" }}>
                  {formatIndianDate(row.superannuationDate)}
                </dd>
              </div>
              <div>
                <dt style={{ color: "var(--mut)", marginBottom: 2 }}>{t("colDaysRemaining")}</dt>
                {/* GAP-HR-RETIREMENT-07: urgency is now also conveyed in
                    text (not colour alone), and pluralised via ICU. */}
                <dd style={{ margin: 0, fontWeight: 600, color: days <= 30 ? "var(--bad, #dc2626)" : days <= 90 ? "var(--warn, #b45309)" : "var(--ink)" }}>
                  {overdueRow ? t("overdueByDays", { count: Math.abs(days) }) : t("daysRemaining", { count: days })}
                  {days >= 0 && days <= 30 && <span> · {t("urgentLabel")}</span>}
                </dd>
              </div>
              <div>
                <dt style={{ color: "var(--mut)", marginBottom: 2 }}>{t("colYearsOfService")}</dt>
                <dd style={{ margin: 0, fontWeight: 600 }}>{yos > 0 ? t("yearsValue", { count: yos }) : "—"}</dd>
              </div>
              <div>
                <dt style={{ color: "var(--mut)", marginBottom: 2 }}>{t("colType")}</dt>
                <dd style={{ margin: 0 }}>{typeLabel(row.separationType, t, tType)}</dd>
              </div>
            </dl>

            {/*
              GAP-HR-RETIREMENT-02: the "Pending Clearances" block (Library/
              Store/IT/Finance chips) is removed entirely -- there is no
              clearance data source anywhere in hrms-service (grep finds no
              "clearance" concept), so every chip always read "pending"
              regardless of reality. Reintroduce once a real clearance
              tracking source exists (see the item's own fix notes), not as
              a UI-only fabrication.
            */}

            {onSelect && (
              <div style={{ padding: "14px 16px 14px" }}>
                <Button
                  variant={selected ? "primary" : "ghost"}
                  style={{ width: "100%", minHeight: 40, fontSize: "0.8125rem" }}
                  aria-pressed={selected}
                  onClick={() => onSelect(row)}
                >
                  {selected ? t("processingThisButton") : t("processThisButton")}
                </Button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
