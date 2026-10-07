import { PageHeader } from "@/app/_components/ds/PageHeader";
import { RefreshErrorState } from "@/app/_components/ds/RefreshErrorState";
import { Card, StatGrid, StatCard } from "@/app/_components/ds";
import { getThemeTokens } from "../../../_data/loaders";
import { ThemeActions } from "../ThemeActions";
import { ThemeTokenTable } from "../ThemeTokenTable";
import { ThemeContrastPanel } from "../ThemeContrastPanel";
import { isCssColour } from "@/lib/colour";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data: themeTokens, source } = await getThemeTokens();

  // GAP-THEMES-TOKENS-01: a failed read must not look like a healthy, empty
  // tenant that merely needs a publish. Show a real error state with Retry and
  // suppress the stats/palette/publish entirely so the page never nudges the
  // user to publish a tenant-wide theme on top of data it could not read.
  if (source === "error") {
    return (
      <div className="page-main">
        <PageHeader
          title="Themes — Tokens"
          subtitle="Tenant branding and token preview workspace."
          back="/themes"
          backLabel="Themes"
        />
        <Card title="Token palette">
          <div className="pad">
            <RefreshErrorState
              error={{
                what: "We could not load the theme tokens.",
                next: "Try again before publishing a new revision.",
                actions: ["retry", "back"],
              }}
              source={{ area: "theme tokens" }}
              backHref="/themes"
            />
          </div>
        </Card>
      </div>
    );
  }

  const total = themeTokens.length;
  const colourTokens = themeTokens.filter((t) => isCssColour(String(t.value ?? ""))).length;
  const scalarTokens = total - colourTokens;

  return (
    <div className="page-main">
      <PageHeader
        title="Themes — Tokens"
        subtitle="Tenant branding and token preview workspace."
        back="/themes"
        backLabel="Themes"
      />

      <StatGrid>
        <StatCard icon="🎨" label="Theme tokens" value={total} />
        <StatCard icon="🌈" tone="warn" label="Colour tokens" value={colourTokens} />
        <StatCard icon="⚙️" tone="info" label="Scalar tokens" value={scalarTokens} />
      </StatGrid>

      {/* GAP-THEMES-TOKENS-03: show a WCAG contrast check for the key colour
          pairs before the user can publish, so an inaccessible palette is
          visible at a glance rather than discovered after it ships. */}
      <ThemeContrastPanel tokens={themeTokens} />

      <ThemeActions />

      <Card title="Token palette">
        <div className="pad">
          <ThemeTokenTable tokens={themeTokens} />
        </div>
      </Card>
    </div>
  );
}
