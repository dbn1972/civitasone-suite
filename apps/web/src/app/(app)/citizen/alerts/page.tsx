import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, RefreshErrorState } from "../../../_components/ds";
import { getCitizenAlerts } from "../../../_data/loaders";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { AlertsTable } from "./AlertsTable";

export default async function AlertsPage() {
  const t = await getTranslations("citizenAlerts");
  const result = await getCitizenAlerts();
  const { data: alerts, source } = result;

  // GAP-CITIZEN-ALERTS-01: a failed fetch must not read as four real zeros.
  // Gate every stat on the loader's source (toResourceState), mirroring the
  // sibling citizen/appeals + citizen/certificates pages, and show "—" (via
  // StatCard's null handling) instead of a fabricated 0.
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  // GAP-CITIZEN-ALERTS-02: status is a free backend string; count on a
  // normalised lower-case value so 'ACTIVE'/'active'/'Active' all count and
  // nothing is silently dropped. GAP-CITIZEN-ALERTS-03: 'Total Published'
  // must exclude drafts, matching its own label.
  const norm = (s: string) => s.trim().toLowerCase();
  const active = errored ? null : alerts.filter((a) => norm(a.status) === "active").length;
  const expired = errored ? null : alerts.filter((a) => norm(a.status) === "expired").length;
  const drafts = errored ? null : alerts.filter((a) => norm(a.status) === "draft").length;
  const published = errored ? null : alerts.filter((a) => norm(a.status) !== "draft").length;

  return (
    <>
      {/* UX-012: the data-source badge now lives inside AlertsTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
      />

      <StatGrid>
        <StatCard icon="🔔" iconBg="#eef2ff" label={t("statActive")} value={active} />
        <StatCard icon="📤" iconBg="#ecfdf3" label={t("statTotal")} value={published} />
        <StatCard icon="⏰" iconBg="#fffaeb" label={t("statExpired")} value={expired} />
        <StatCard icon="📝" iconBg="#fce7ee" label={t("statDrafts")} value={drafts} />
      </StatGrid>

      {errored ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "alerts" })} backHref="/citizen" />
          </div>
        </div>
      ) : (
        <AlertsTable alerts={alerts} source={source} />
      )}
    </>
  );
}
