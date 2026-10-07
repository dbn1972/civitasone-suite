import { getTranslations } from "next-intl/server";
import { PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getCatalogueServices } from "../../../_data/citizenPartials";
import { CatalogueTable } from "./CatalogueTable";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";

/** SVC-081 — Government service catalogue (versioned, published services). */
export default async function CataloguePage() {
  const t = await getTranslations("citizenCatalogue");
  const result = await getCatalogueServices();
  const { data: services } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";
  const totalAvailable = errored ? null : services.length;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
      />

      <div className="card">
        <div className="pad" style={{ borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
          <strong>{t("listTitle")}</strong>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{totalAvailable ?? "—"} available</span>
        </div>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "service catalogue" })} />
          </div>
        ) : services.length === 0 ? (
          <div className="pad" style={{ color: "var(--muted)" }}>{t("empty")}</div>
        ) : (
          <div className="pad">
            <CatalogueTable services={services} />
          </div>
        )}
      </div>
    </>
  );
}
