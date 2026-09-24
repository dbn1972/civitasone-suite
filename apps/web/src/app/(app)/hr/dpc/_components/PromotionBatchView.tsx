"use client";
/**
 * PromotionBatchView — Sprint 13 / Lifecycle Phase 1
 * DPC batch promotions: shows all employees in the DPC with individual
 * promotion status. Summary counts at top.
 */
import { useTranslations } from "next-intl";
import type { PromotionRow } from "../../promotion/_components/PromotionCard";
import { PromotionCard } from "../../promotion/_components/PromotionCard";
import { StatGrid, StatCard } from "@/app/_components/ds";

interface Props {
  promotions: PromotionRow[];
}

export function PromotionBatchView({ promotions }: Props) {
  const t = useTranslations("dpcBatchView");
  if (promotions.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--ink3)" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📈</div>
        <p style={{ margin: 0, fontWeight: 600 }}>{t("emptyTitle")}</p>
        <p style={{ margin: "6px 0 0", fontSize: "0.875rem" }}>
          {t("emptyMessage")}
        </p>
      </div>
    );
  }

  const initiated  = promotions.filter((p) => p.status === "pending").length;
  const inProgress = promotions.filter((p) => ["dept_approved", "hr_approved", "finance_approved", "approved"].includes(p.status)).length;
  const signed     = promotions.filter((p) => ["signed", "completed"].includes(p.status)).length;
  const cancelled  = promotions.filter((p) => p.status === "cancelled").length;

  return (
    <div>
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg, #e0f2fe)" label={t("statTotalInBatch")}  value={promotions.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fef9c3)" label={t("statInitiated")}      value={initiated} />
        <StatCard icon="🔄" iconBg="var(--primary-soft, #ede9fe)"                 label={t("statInApproval")}     value={inProgress} />
        <StatCard icon="✅" iconBg="var(--goodbg, #dcfce7)"  label={t("statSignedIssued")}  value={signed} />
        {cancelled > 0 && (
          <StatCard icon="❌" iconBg="var(--badbg, #fee2e2)" label={t("statCancelled")} value={cancelled} />
        )}
      </StatGrid>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", marginTop: 16 }}>
        {promotions.map((p) => (
          <PromotionCard key={p.id} promotion={p} />
        ))}
      </div>
    </div>
  );
}
