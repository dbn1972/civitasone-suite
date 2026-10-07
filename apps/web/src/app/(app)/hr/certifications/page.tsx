import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { CertificationCard } from "./_components/CertificationCard";
import { deriveCardStatus, isMandatory, type CertificationStatus } from "@/lib/certifications";
import { getTranslations } from "next-intl/server";

type Row = {
  id: string;
  employee: string;
  department: string;
  certification: string;
  issuingBody: string;
  trainingId: string | null;
  issuedDate: string;
  expiryDate: string | null;
} & Record<string, unknown>;

// GAP-HR-CERTIFICATIONS-06: status/mandatory derivation now lives in the
// single shared apps/web/src/lib/certifications.ts (was duplicated here and
// in CertificationCard.tsx, with a substring-match bug in the keyword list).
const STATUS_SORT_ORDER: Record<CertificationStatus, number> = {
  expired: 0, expiring_soon: 1, valid: 2, no_expiry: 3,
};

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/certifications", [], {
    telemetryKey: "hr.certifications",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function CertificationsPage() {
  const t = await getTranslations("certifications");
  const { data: items, source } = await getData();

  const valid        = items.filter((i) => deriveCardStatus(i.expiryDate) === "valid").length;
  const expiringSoon = items.filter((i) => deriveCardStatus(i.expiryDate) === "expiring_soon").length;
  const expired      = items.filter((i) => deriveCardStatus(i.expiryDate) === "expired").length;
  // GAP-HR-CERTIFICATIONS-01: whether ANY row actually has expiry tracking
  // data at all. Right after this ships, every existing training programme's
  // validity_months is still NULL (never backfilled to a guess), so every
  // row's expiryDate is null -- expiringSoon/expired would both be a real,
  // honestly-computed 0, but showing "0 expiring, 0 expired" is visually
  // indistinguishable from the old fabricated-zero bug. Show an explicit
  // "not configured" notice instead of those two tiles/the banner in that
  // case, rather than a zero that looks like a clean bill of health.
  const anyTracked = items.some((i) => !!i.expiryDate);

  // Sort: expired first, then expiring_soon, then valid, then no_expiry last
  const sorted = [...items].sort(
    (a, b) => STATUS_SORT_ORDER[deriveCardStatus(a.expiryDate)] - STATUS_SORT_ORDER[deriveCardStatus(b.expiryDate)],
  );

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel={t("backToHr")}
        actions={<span />}
      />
      <DataSourceBadge source={source} />

      <StatGrid>
<StatCard icon="🏅" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statValid")}              value={valid} />
        {anyTracked && (
          <>
            <StatCard icon="⚠️" iconBg="var(--warnbg, #fff7e6)" label={t("statExpiringSoon")}      value={expiringSoon} />
            <StatCard icon="🚫" iconBg="var(--badbg, #fff1f0)" label={t("statExpired")}            value={expired} />
          </>
        )}
      </StatGrid>

      {/* Alert banner */}
      {anyTracked ? (
        (expiringSoon > 0 || expired > 0) && (
          <div
            role="alert"
            style={{
              background: "var(--warnbg, #fffbeb)",
              border: "1px solid var(--warnbd, #fcd34d)",
              borderRadius: 8,
              padding: "10px 14px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 13,
              color: "var(--warn, #92400e)",
            }}
          >
            <span style={{ fontSize: 16 }}>⚠</span>
            <span>{t("alertBanner", { expired, expiringSoon })}</span>
          </div>
        )
      ) : (
        items.length > 0 && (
          <div
            role="status"
            style={{
              background: "var(--line2, #f1f5f9)",
              border: "1px solid var(--line, #e2e8f0)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              color: "var(--mut, #64748b)",
            }}
          >
            {t("noExpiryTracking")}
          </div>
        )
      )}

      <Card title={t("cardTitle")}>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "certifications" })} backHref="/hr" />
        ) : sorted.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--mut)" }}>
            <p style={{ fontSize: 32, margin: "0 0 8px" }}>🏅</p>
            <p style={{ fontWeight: 600, color: "var(--ink2, #475569)", margin: 0 }}>{t("emptyTitle")}</p>
            <p style={{ fontSize: 13, margin: "4px 0 0" }}>
              {t("emptyMessage")}
            </p>
          </div>
        ) : (
          <div
            style={{
              padding: "12px 16px 16px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 14,
            }}
          >
            {sorted.map((row) => (
              <CertificationCard
                key={row.id}
                id={row.id}
                certificationName={row.certification}
                issuingBody={row.issuingBody}
                obtainedDate={row.issuedDate}
                expiryDate={row.expiryDate}
                isMandatory={isMandatory(row.certification)}
                status={deriveCardStatus(row.expiryDate)}
                // GAP-HR-CERTIFICATIONS-03: a plain href, not a callback --
                // this is a Server Component, so a function prop can't cross
                // to the Client Component CertificationCard. Renewal links to
                // this same training programme's own enrol page (the
                // existing hr/training/[id] flow); no deep "re-nominate"
                // endpoint exists yet, so this is the lowest-risk real
                // destination rather than inventing a new one.
                renewHref={row.trainingId ? `/hr/training/${row.trainingId}` : undefined}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
