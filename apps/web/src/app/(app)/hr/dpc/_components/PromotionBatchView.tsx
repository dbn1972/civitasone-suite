"use client";
/**
 * PromotionBatchView — Sprint 13 / Lifecycle Phase 1
 * DPC batch promotions: shows all employees in the DPC with individual
 * promotion status. Summary counts at top.
 */
import type { PromotionRow } from "../../promotion/_components/PromotionCard";
import { PromotionCard } from "../../promotion/_components/PromotionCard";
import { StatGrid, StatCard } from "@/app/_components/ds";

interface Props {
  promotions: PromotionRow[];
}

export function PromotionBatchView({ promotions }: Props) {
  if (promotions.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--ink3)" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📈</div>
        <p style={{ margin: 0, fontWeight: 600 }}>No DPC promotions recorded</p>
        <p style={{ margin: "6px 0 0", fontSize: "0.875rem" }}>
          Raise promotions from employee profiles or use the Promotions module.
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
        <StatCard icon="📋" iconBg="var(--infobg, #e0f2fe)" label="Total in Batch"   value={promotions.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fef9c3)" label="Initiated"        value={initiated} />
        <StatCard icon="🔄" iconBg="#ede9fe"                 label="In Approval"      value={inProgress} />
        <StatCard icon="✅" iconBg="var(--goodbg, #dcfce7)"  label="Signed & Issued"  value={signed} />
        {cancelled > 0 && (
          <StatCard icon="❌" iconBg="#fee2e2" label="Cancelled" value={cancelled} />
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
