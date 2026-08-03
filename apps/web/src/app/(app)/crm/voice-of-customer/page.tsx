import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCrmSentimentSummary } from "../../../_data/loaders";
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

export default async function VoiceOfCustomerPage() {
  const { data: summary, source } = await getCrmSentimentSummary();

  const mood = moodOf(summary);
  const themes = rankThemes(summary);
  const concern = topConcern(summary);

  return (
    <>
      <PageHeader
        title="Voice of Customer"
        subtitle="What customers are actually saying — every logged interaction is scored for sentiment and grouped by theme."
        back="/crm"
        actions={
          <a className="btn" href="/crm/activities">
            All Interactions
          </a>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}

      <StatGrid>
        <StatCard
          icon={MOOD_ICON[mood]}
          iconBg={MOOD_ICON_BG[mood]}
          label="Overall Sentiment"
          value={MOOD_LABEL[mood]}
        />
        <StatCard
          icon="💬"
          iconBg="#e0f2fe"
          label="Interactions Scored"
          value={summary.total.toLocaleString("en-IN")}
        />
        <StatCard
          icon="📉"
          iconBg="#fee2e2"
          label="Negative Share"
          value={summary.total === 0 ? "—" : `${summary.negativeShare}%`}
        />
        <StatCard
          icon="🎯"
          iconBg="#fef3c7"
          label="Top Concern"
          value={concern ? themeLabel(concern.theme) : "None"}
        />
      </StatGrid>

      {summary.truncated && (
        <Card title="Partial window">
          <p>
            More interactions have been scored than this summary can scan in one
            pass, so the figures below cover the most recent activity only.
            Narrow the period to read an exact figure.
          </p>
        </Card>
      )}

      <Card title="Sentiment Mix">
        <StatGrid>
          <StatCard
            icon="🙂"
            iconBg="#dcfce7"
            label="Positive"
            value={`${summary.byPolarity.positive.toLocaleString("en-IN")} (${shareOf(summary, "positive")}%)`}
          />
          <StatCard
            icon="😐"
            iconBg="#fef3c7"
            label="Neutral"
            value={`${summary.byPolarity.neutral.toLocaleString("en-IN")} (${shareOf(summary, "neutral")}%)`}
          />
          <StatCard
            icon="🙁"
            iconBg="#fee2e2"
            label="Negative"
            value={`${summary.byPolarity.negative.toLocaleString("en-IN")} (${shareOf(summary, "negative")}%)`}
          />
          <StatCard
            icon="📊"
            iconBg="#e0e7ff"
            label="Average Score"
            value={summary.total === 0 ? "—" : `${summary.averageScore} / 100`}
          />
        </StatGrid>
      </Card>

      <Card title="What They Are Talking About">
        <ThemeTable themes={themes} />
      </Card>
    </>
  );
}
