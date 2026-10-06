import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { getCrmLeadCaptureForms } from "../../../_data/loaders";
import { LeadFormsTable } from "./LeadFormsTable";
import { formHealth, rankForms } from "./leadForms";

export const dynamic = "force-dynamic";

export default async function LeadFormsPage() {
  const t = await getTranslations("crmLeadFormsPage");
  const { data: forms, source } = await getCrmLeadCaptureForms();
  const ranked = rankForms(forms);
  const live = forms.filter((f) => formHealth(f) === "live").length;
  const unlawful = forms.filter((f) => formHealth(f) === "unlawful").length;

  // Never fabricate a 0 count when the list load failed — show "—" instead
  // (matches the pattern already used on dashboard/accounts/contacts).
  const stat = (n: number) => (source === "error" ? "—" : n.toLocaleString("en-IN"));

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm"
        backLabel={t("backLabel")}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🌐" tone="info" label={t("statForms")} value={stat(forms.length)} />
        <StatCard icon="✅" tone="good" label={t("statLive")} value={stat(live)} />
        <StatCard icon="⛔" tone="bad" label={t("statConsentGaps")} value={stat(unlawful)} />
      </StatGrid>

      {/* GAP-CRM-LEAD-FORMS-03: explain the "Consent gaps" condition in DPDP
          terms when there is at least one such form, so the tile and pill are
          not the only (unexplained) signal. */}
      {source !== "error" && unlawful > 0 && (
        <p
          role="note"
          style={{
            margin: "4px 0 12px",
            padding: "10px 14px",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--ink2)",
            background: "color-mix(in srgb, var(--bad) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--bad) 30%, transparent)",
            borderRadius: "var(--r)",
          }}
        >
          {t("consentGapNote")}
        </p>
      )}

      {/* GAP-CRM-LEAD-FORMS-04: on an outage, show a retry state in place of the
          table (the tiles already show "—") instead of the table's own
          "No website forms registered" empty copy, which would read as an
          empty registry rather than a failed load. */}
      {source === "error" ? (
        <Card title={t("registeredForms")}>
          <RefreshErrorState
            error={{
              what: t("loadErrorWhat"),
              next: t("loadErrorNext"),
              actions: ["retry", "back", "help"],
            }}
            backHref="/crm"
            source={{ area: "lead-form registry" }}
          />
        </Card>
      ) : (
        <Card title={t("registeredForms")}>
          <LeadFormsTable rows={ranked} />
        </Card>
      )}
    </>
  );
}
