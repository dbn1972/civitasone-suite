"use client";
/**
 * PromotionBatchView — Sprint 13 / Lifecycle Phase 1
 * DPC batch promotions: shows all employees in the DPC with individual
 * promotion status. Summary counts at top.
 *
 * GAP-HR-DPC-07: the Cancelled StatCard now always renders (value 0 when
 * there are none) instead of appearing only when count>0 — a stat grid
 * that silently changes its own column count between 4 and 5 depending on
 * data is a layout-stability bug, not a feature.
 */
import { useTranslations } from "next-intl";
import type { PromotionRow } from "../../promotion/_components/PromotionCard";
import { PromotionCard } from "../../promotion/_components/PromotionCard";
import { StatGrid, StatCard } from "@/app/_components/ds";
import { bucketPromotions } from "./batchStatuses";

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

  // GAP-HR-DPC-02: every status lands in a bucket (pending_approval and
  // pending_effective used to be in none), so the tiles add up to the total.
  const { initiated, inApproval, awaitingEffective, signed, cancelled, other } = bucketPromotions(promotions);

  return (
    <div>
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotalInBatch")}  value={promotions.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statInitiated")}      value={initiated} />
        <StatCard icon="🔄" iconBg="var(--primary-soft)"                 label={t("statInApproval")}     value={inApproval} />
        <StatCard icon="📅" iconBg="var(--infobg)" label={t("statAwaitingEffective")} value={awaitingEffective} />
        <StatCard icon="✅" iconBg="var(--goodbg)"  label={t("statSignedIssued")}  value={signed} />
        <StatCard icon="❌" iconBg="var(--badbg)" label={t("statCancelled")} value={cancelled} />
        {other > 0 ? <StatCard icon="❔" iconBg="var(--bg)" label={t("statOther")} value={other} /> : null}
      </StatGrid>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", marginTop: 16 }}>
        {promotions.map((p) => (
          <PromotionCard key={p.id} promotion={p} />
        ))}
      </div>
    </div>
  );
}
