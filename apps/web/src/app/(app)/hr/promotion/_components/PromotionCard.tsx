"use client";
/**
 * PromotionCard — Sprint 13 / Lifecycle Phase 1
 * Shows: current designation → new designation (with arrow), effective date,
 * order number, increment in pay. Approval chain: Dept Head → HR → Finance → Signed.
 *
 * GAP-HR-DPC-02: GET /v1/hrms/lifecycle/promotions (services/hrms-service/
 * .../lifecycle/routes.ts) already batch-resolves employeeName / department /
 * fromDesignationName / toDesignationName server-side (GAP-HR-SF-17) — this
 * component's own field names (`fromDesignation`, `toDesignation`) just
 * never matched what THAT API actually sends, so every card still fell
 * through to the raw-UUID fallback despite the backend enrichment already
 * existing. Field names below now match that real response; the UUID
 * fallbacks stay (never remove them — see GAP-HR-DPC-02's own fix step 3:
 * "remove the UUID fallbacks: show '—' ... instead") except they now render
 * "—", never the raw id.
 *
 * This component is ALSO used by /hr/promotion/page.tsx (unrelated to this
 * GAP, not touched here), which falls back to a SECOND, differently-shaped
 * endpoint — lifecycle/m7-list-routes.ts's un-prefixed GET /v1/hrms/
 * promotions — when the primary one returns zero rows. That route's own
 * field names are `employee` (not `employeeName`) and `fromGrade`/`toGrade`
 * for the designation text (no `fromDesignationName`/`toDesignationName` at
 * all). `employee` and `fromGrade`/`toGrade` stay in the fallback chains
 * below for that reason — this is genuinely two backends' worth of field
 * names converging on one shared card, not leftover dead code.
 *
 * GAP-HR-DPC-02: "DPC Meeting Date" is removed — `dpcDate` has no backing
 * column on hrms_promotions and no DPC-batch concept exists in the schema to
 * populate it from (see this GAP's own two options: add a migration + decide
 * who sets it, or drop the field; dropping is the safe default here, see PR
 * description).
 */
import { useTranslations } from "next-intl";
import { StatusPill } from "@/app/_components/ds";
import { formatIndianDate, formatMoney } from "@/lib/formatters";

export type PromotionRow = {
  id: string;
  employeeName?: string;
  /** m7-list-routes.ts's GET /v1/hrms/promotions fallback shape (see doc comment above) — not this GAP's own endpoint. */
  employee?: string;
  employeeId?: string;
  department?: string;
  fromGrade?: string;
  toGrade?: string;
  fromDesignationName?: string;
  toDesignationName?: string;
  fromDesigId?: string;
  toDesigId?: string;
  effectiveDate?: string | null;
  orderNo?: string | null;
  orderRef?: string | null;
  newBasicMinor?: number | null;
  status: string;
  createdAt?: string;
} & Record<string, unknown>;

// UX-017: values are looked up by key through t() at render time (see
// PromotionCard below) so status/chain labels stay in the active locale;
// these lookup tables only carry the status-string -> key mapping.
const STATUS_LABEL_KEYS: Record<string, string> = {
  pending: "statusInitiated",
  dept_approved: "statusDeptApproved",
  hr_approved: "statusHrApproved",
  finance_approved: "statusFinanceApproved",
  approved: "statusFinanceApproved",
  signed: "statusSignedIssued",
  completed: "statusCompleted",
  cancelled: "statusCancelled",
};

const CHAIN: Array<{ key: string; labelKey: string; icon: string }> = [
  { key: "dept_approved",    labelKey: "chainDeptHead", icon: "🏢" },
  { key: "hr_approved",      labelKey: "chainHr",        icon: "👥" },
  { key: "finance_approved", labelKey: "chainFinance",   icon: "💰" },
  { key: "signed",           labelKey: "chainSigned",    icon: "✍️" },
];

function chainIndex(status: string): number {
  const map: Record<string, number> = {
    pending: -1,
    dept_approved: 0,
    hr_approved: 1,
    finance_approved: 2, approved: 2,
    signed: 3, completed: 3,
  };
  return map[status] ?? -1;
}

interface Props { promotion: PromotionRow; }

export function PromotionCard({ promotion }: Props) {
  const t           = useTranslations("promotionCard");
  const statusKey   = STATUS_LABEL_KEYS[promotion.status];
  const statusLabel = statusKey ? t(statusKey) : promotion.status;
  const chainIdx    = chainIndex(promotion.status);
  const isCancelled  = promotion.status === "cancelled";
  // GAP-HR-DPC-02/07: "—" for a genuinely unnamed employee, never the raw
  // UUID and never a hard-coded English "Unknown". `employeeName` is this
  // GAP's own endpoint; `employee` is the OTHER endpoint /hr/promotion can
  // fall back to (see this file's top doc comment) — both are real,
  // current field names, not one live one dead.
  const empLabel    = promotion.employeeName ?? promotion.employee ?? t("unknownEmployee");
  const fromLabel   = promotion.fromDesignationName ?? promotion.fromGrade ?? "—";
  const toLabel     = promotion.toDesignationName   ?? promotion.toGrade   ?? "—";
  const payStr      = promotion.newBasicMinor != null
    ? formatMoney(Number(promotion.newBasicMinor))
    : null;

  return (
    <div className="card" style={{ marginBottom: 0 }} aria-label={t("cardAriaLabel", { name: empLabel })}>
      <div className="card-h" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>{empLabel}</h3>
          {promotion.department && (
            <p style={{ margin: "2px 0 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>{promotion.department}</p>
          )}
        </div>
        <StatusPill status={promotion.status} label={statusLabel} />
      </div>

      <div className="pad" style={{ paddingTop: 4 }}>
        {/* Designation progression */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 16px", background: "var(--panel, #f8fafc)",
          borderRadius: 10, marginBottom: 14, flexWrap: "wrap",
        }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: "0.6875rem", color: "var(--mut)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("currentLabel")}</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.9375rem", fontWeight: 600 }}>{fromLabel}</p>
          </div>
          <div style={{ fontSize: 22, color: "var(--info, #2563eb)", flexShrink: 0 }}>&#8594;</div>
          <div style={{ textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: "0.6875rem", color: "var(--mut)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("promotedToLabel")}</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.9375rem", fontWeight: 700, color: "var(--good, #16a34a)" }}>{toLabel}</p>
          </div>
          {payStr && (
            <div style={{ marginInlineStart: "auto", textAlign: "end" }}>
              <p style={{ margin: 0, fontSize: "0.6875rem", color: "var(--mut)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("newBasicLabel")}</p>
              <p style={{ margin: "4px 0 0", fontSize: "1rem", fontWeight: 700, color: "var(--good, #0f766e)" }}>{payStr}</p>
            </div>
          )}
        </div>

        {/* Key fields */}
        <div className="fields">
          {(promotion.orderNo ?? promotion.orderRef) && (
            <div className="fld">
              <span className="l">{t("orderNoLabel")}</span>
              <span className="v" style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>
                {promotion.orderNo ?? promotion.orderRef}
              </span>
            </div>
          )}
          {promotion.effectiveDate && (
            <div className="fld">
              <span className="l">{t("effectiveDateLabel")}</span>
              <span className="v">{formatIndianDate(promotion.effectiveDate)}</span>
            </div>
          )}
        </div>

        {/* Approval chain */}
        <div style={{ marginTop: 16 }}>
          <p style={{ margin: "0 0 8px", fontSize: "0.75rem", color: "var(--mut)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {t("approvalChainLabel")}
          </p>
          {isCancelled ? (
            <p style={{ margin: "0", fontSize: "0.8125rem", color: "var(--ink2)" }}>
              {t("cancelledMessage")}
            </p>
          ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CHAIN.map(({ key, labelKey, icon }, i) => {
              const done   = i <= chainIdx;
              const active = i === chainIdx + 1;
              return (
                <div key={key} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 12px", borderRadius: 20, border: "1px solid",
                  borderColor: done ? "var(--good, #16a34a)" : active ? "var(--info, #2563eb)" : "var(--line)",
                  background:  done ? "var(--goodbg, #f0fdf4)" : active ? "var(--infobg, #eff6ff)" : "transparent",
                  fontSize: "0.8125rem", fontWeight: done || active ? 600 : 400,
                  color: done ? "var(--good, #16a34a)" : active ? "var(--info, #2563eb)" : "var(--mut)",
                }}>
                  <span>{done ? "✓" : icon}</span>
                  <span>{t(labelKey)}</span>
                </div>
              );
            })}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
