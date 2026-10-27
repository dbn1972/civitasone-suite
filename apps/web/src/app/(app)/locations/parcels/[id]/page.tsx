import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader, Card, StatusPill, DataTable, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { formatDateTimeIST, formatEnumLabel } from "@/lib/formatters";
import { getParcel, getParcelHistory, type ParcelEvent } from "../../_data";

export const dynamic = "force-dynamic";

const BACK = "/locations/maps/monitoring";
const LAND_USES = ["agricultural", "residential", "commercial", "industrial", "forest", "wetland", "barren"] as const;
const OWNERSHIPS = ["private", "government", "community", "temple_trust"] as const;

/**
 * GAP-LOCATIONS-MAPS-MONITORING-01: the record behind a parcel marker on the monitoring map. A parcel that
 * does not exist (or belongs to another organisation) is a real 404; a failed load is a retryable error,
 * never an empty parcel.
 */
export default async function ParcelDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const [parcel, history] = await Promise.all([getParcel(id), getParcelHistory(id)]);
  const t = await getTranslations("locationsParcel");

  if (parcel.source === "error") {
    if (parcel.status === 404) notFound();
    return (
      <div className="page-main">
        <PageHeader title={t("pageTitle")} back={BACK} backLabel={t("backLabel")} />
        <LoadErrorState result={parcel} area={t("area")} backHref={BACK} backLabel={t("backLabel")} />
      </div>
    );
  }
  const p = parcel.data;
  if (!p) notFound();

  const landUse = (LAND_USES as readonly string[]).includes(p.landUse) ? t(`landUse.${p.landUse as (typeof LAND_USES)[number]}`) : formatEnumLabel(p.landUse);
  const ownership = (OWNERSHIPS as readonly string[]).includes(p.ownershipType) ? t(`ownership.${p.ownershipType as (typeof OWNERSHIPS)[number]}`) : formatEnumLabel(p.ownershipType);
  const area = p.areaSquareMeters !== undefined ? `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(p.areaSquareMeters)} ${t("areaUnit")}` : "—";

  type Row = ParcelEvent & Record<string, unknown>;
  const events = history.data.map((e) => ({ ...e, when: formatDateTimeIST(e.createdAt), what: formatEnumLabel(e.eventType) })) as Array<Row & { when: string; what: string }>;

  return (
    <div className="page-main">
      <PageHeader
        title={t("title", { parcelNo: p.parcelNo })}
        subtitle={t("subtitle", { village: p.village, district: p.district })}
        back={BACK}
        backLabel={t("backLabel")}
        actions={<StatusPill status={p.status} />}
      />
      <Card title={t("detailsTitle")} padding>
        <dl style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", margin: 0 }}>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>{t("parcelNo")}</dt><dd style={{ margin: 0 }}>{p.parcelNo}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>{t("village")}</dt><dd style={{ margin: 0 }}>{p.village}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>{t("district")}</dt><dd style={{ margin: 0 }}>{p.district}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>{t("area")}</dt><dd style={{ margin: 0 }}>{area}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>{t("landUseLabel")}</dt><dd style={{ margin: 0 }}>{landUse}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>{t("ownershipLabel")}</dt><dd style={{ margin: 0 }}>{ownership}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>{t("boundaryLabel")}</dt><dd style={{ margin: 0 }}>{p.boundaryPoints > 0 ? t("boundaryPoints", { count: p.boundaryPoints }) : "—"}</dd></div>
        </dl>
      </Card>

      <Card title={t("historyTitle")}>
        {history.source === "error" ? (
          <LoadErrorState result={history} area={t("historyArea")} backHref={BACK} backLabel={t("backLabel")} />
        ) : events.length === 0 ? (
          <EmptyState icon="🕘" title={t("historyEmptyTitle")} message={t("historyEmptyMessage")} />
        ) : (
          <DataTable<Row & { when: string; what: string }>
            columns={[
              { key: "what", label: t("colEvent") },
              { key: "when", label: t("colWhen") },
            ]}
            rows={events}
            pageSize={15}
          />
        )}
      </Card>
    </div>
  );
}
