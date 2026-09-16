"use client";

import { useTranslations } from "next-intl";
import { Card, EmptyState } from "../../../_components/ds";
import type { PfmsConfig } from "./types";

/**
 * Read-only — GET /v1/finance/pfms/config. finance-service does not register a
 * POST/PUT route to set this configuration (see PR "## BACKEND FOLLOW-UPS");
 * agency code / default DDO must be provisioned by an administrator directly.
 */
export function ConfigPanel({ config }: { config: PfmsConfig | null }) {
  const t = useTranslations("pfmsConfigPanel");

  if (!config || (!config.agencyCode && !config.defaultDdo)) {
    return (
      <EmptyState
        icon="⚙️"
        title={t("emptyTitle")}
        message={t("emptyMessage")}
      />
    );
  }

  return (
    <Card title={t("title")} padding>
      <dl className="fields">
        <div className="fld">
          <dt className="l">{t("agencyCode")}</dt>
          <dd className="v" style={{ margin: 0 }}>{config.agencyCode ?? "—"}</dd>
        </div>
        <div className="fld">
          <dt className="l">{t("defaultDdo")}</dt>
          <dd className="v" style={{ margin: 0 }}>{config.defaultDdo ?? "—"}</dd>
        </div>
      </dl>
    </Card>
  );
}
