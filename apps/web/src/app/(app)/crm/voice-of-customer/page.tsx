import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, PageHeader, RefreshErrorState, StatCard, StatGrid } from "../../../_components/ds";
import { getCrmSentimentSummary } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { PeriodFilter } from "./PeriodFilter";
import { ThemeTable } from "./ThemeTable";
import {
  MOOD_ICON,
  MOOD_ICON_BG,
  MOOD_LABEL,
  moodOf,
  rankThemes,
  shareOf,
  themeLabel,
  topConcern,
} from "./voc";

/** ISO yyyy-mm-dd (what the date inputs / presets produce). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Keep only a well-formed window. An invalid or inverted range (from > to) is
 * dropped entirely rather than sent to the server — the page then shows the
 * full aggregate and a validation note, never a half-applied filter.
 */
function parseRange(sp?: { from?: string; to?: string }): { range: { from?: string; to?: string }; invalid: boolean } {
  const from = sp?.from && ISO_DATE.test(sp.from) ? sp.from : undefined;
  const to = sp?.to && ISO_DATE.test(sp.to) ? sp.to : undefined;
  const malformed = (sp?.from != null && sp.from !== "" && !from) || (sp?.to != null && sp.to !== "" && !to);
  if (from && to && from > to) return { range: {}, invalid: true };
  return { range: { ...(from ? { from } : {}), ...(to ? { to } : {}) }, invalid: malformed };
}

export default async function VoiceOfCitizenPage({
  searchParams,
}: {
  searchParams?: { from?: string; to?: string };
}) {
  const t = await getTranslations("crmVoiceOfCitizen");
  const { range, invalid } = parseRange(searchParams);
  const { data: summary, source } = await getCrmSentimentSummary(range);

  // The loader falls back to an all-zero summary on a failed fetch (there's no
  // sensible non-zero default for an aggregate), so every figure below must be
  // gated on source==="error" too — otherwise a failed load reads as "citizen
  // sentiment is neutral and nothing was scored" instead of "unavailable".
  const isError = source === "error";
  const mood = moodOf(summary);
  const themes = rankThemes(summary);
  const concern = topConcern(summary);
  const windowLabel =
    range.from || range.to
      ? t("windowRange", { from: range.from ?? t("earliest"), to: range.to ?? t("today") })
      : t("windowAll");

  return (
    <>
      <PageHeader
        title="Voice of Citizen"
        subtitle={t("subtitle", { window: windowLabel })}
        back="/crm"
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <PeriodFilter from={range.from} to={range.to} />
            <a className="btn" href="/crm/voice-of-customer/feedback">
              {t("feedbackForm")}
            </a>
            <a className="btn" href="/crm/activities">
              All Interactions
            </a>
          </div>
        }
      />
      <div role="note" aria-label="Data protection notice" className="flex items-start gap-2.5 mt-2 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <span aria-hidden="true" className="text-base leading-snug">🛡</span>
        <span>Citizen feedback is anonymised in aggregate reporting. Individual feedback access is subject to DPDP Act 2023 provisions.</span>
      </div>
      {invalid && (
        <div role="alert" className="flex items-start gap-2.5 mt-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <span aria-hidden="true">⚠</span>
          <span>{t("invalidPeriod")}</span>
        </div>
      )}
      {source === "error" && <DataSourceBadge source={source} />}

      <StatGrid>
        <StatCard
          icon={MOOD_ICON[mood]}
          iconBg={MOOD_ICON_BG[mood]}
          label="Overall Sentiment"
          value={isError ? "—" : MOOD_LABEL[mood]}
        />
        <StatCard
          icon="▣"
          iconBg="#e0f2fe"
          label="Interactions Scored"
          value={isError ? "—" : summary.total.toLocaleString("en-IN")}
        />
        <StatCard
          icon="△"
          iconBg="#fee2e2"
          label="Negative Share"
          value={isError || summary.total === 0 ? "—" : `${summary.negativeShare}%`}
        />
        <StatCard
          icon="◈"
          iconBg="#fef3c7"
          label="Primary Concern"
          value={isError ? "—" : concern ? themeLabel(concern.theme) : "None"}
        />
      </StatGrid>

      {summary.truncated && !isError && (
        <Card title="Partial window">
          <p>
            {t("partialWindowBody")}
          </p>
        </Card>
      )}

      <Card title="Sentiment Mix">
        <StatGrid>
          <StatCard
            icon="▲"
            iconBg="#dcfce7"
            label="Positive"
            value={isError ? "—" : `${summary.byPolarity.positive.toLocaleString("en-IN")} (${shareOf(summary, "positive")}%)`}
          />
          <StatCard
            icon="○"
            iconBg="#fef3c7"
            label="Neutral"
            value={isError ? "—" : `${summary.byPolarity.neutral.toLocaleString("en-IN")} (${shareOf(summary, "neutral")}%)`}
          />
          <StatCard
            icon="▽"
            iconBg="#fee2e2"
            label="Negative"
            value={isError ? "—" : `${summary.byPolarity.negative.toLocaleString("en-IN")} (${shareOf(summary, "negative")}%)`}
          />
          <StatCard
            icon="▣"
            iconBg="#e0e7ff"
            label="Average Score"
            value={isError || summary.total === 0 ? "—" : `${summary.averageScore} / 100`}
          />
        </StatGrid>
      </Card>

      <Card title="Key Feedback Themes">
        {isError ? (
          <RefreshErrorState
            error={toHumanError("load", { area: "citizen feedback themes" })}
            backHref="/crm"
            source={{ area: "citizen feedback themes" }}
          />
        ) : (
          <ThemeTable themes={themes} />
        )}
      </Card>
    </>
  );
}
