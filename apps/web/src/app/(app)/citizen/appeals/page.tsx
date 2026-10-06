import { getTranslations } from "next-intl/server";
import { PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getAppeals } from "../../../_data/citizenPartials";
import { AppealPanel } from "./AppealPanel";
import { AppealsTable } from "./AppealsTable";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";

/** SVC-089 — Appeal, review & revision. */
export default async function AppealsPage() {
  const t = await getTranslations("citizenAppeals");
  const result = await getAppeals();
  const { data: appeals } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";
  const totalFiled = errored ? null : appeals.length;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
      />

      <AppealPanel />

      <div className="card" style={{ marginTop: 16 }}>
        <div className="pad" style={{ borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
          <strong>{t("listTitle")}</strong>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{totalFiled ?? "—"} filed</span>
        </div>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "appeals" })} />
          </div>
        ) : appeals.length === 0 ? (
          <div className="pad" style={{ color: "var(--muted)" }}>{t("empty")}</div>
        ) : (
          <div className="pad">
            <AppealsTable appeals={appeals} />
          </div>
        )}
      </div>
    </>
  );
}
