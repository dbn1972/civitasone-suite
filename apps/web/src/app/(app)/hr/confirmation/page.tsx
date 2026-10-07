/**
 * Probation Confirmation page — Sprint 14 / Lifecycle Phase 2
 * Card grid via ProbationConfirmationList (replaces plain DataTable).
 */
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import {
  ProbationConfirmationList,
  type ConfirmationRow,
} from "./_components/ProbationConfirmationCard";
import { daysUntilIST } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";

// GAP-HR-CONFIRMATION-07: the API caps at 500 rows and reports `hasMore` --
// previously discarded by mapResponse, which only ever kept the `data` array.
type ConfirmationData = { rows: ConfirmationRow[]; hasMore: boolean };

async function getData(): Promise<LoaderResult<ConfirmationData>> {
  return fetchJson<unknown, ConfirmationData>(
    "/api/v1/hrms/confirmations",
    { rows: [], hasMore: false },
    {
      telemetryKey: "hr.confirmations",
      mapResponse: (p) => {
        const body = p as { data?: ConfirmationRow[]; hasMore?: boolean } | ConfirmationRow[];
        const arr = Array.isArray(body) ? body : body?.data;
        if (!Array.isArray(arr)) return null;
        return { rows: arr, hasMore: Array.isArray(body) ? false : Boolean(body?.hasMore) };
      },
    },
  );
}

export default async function ConfirmationPage() {
  const t = await getTranslations("confirmation");
  const { data, source, status, errorMessage } = await getData();
  const { rows: items, hasMore } = data;
  const errored = source === "error";

  // GAP-HR-CONFIRMATION-06: bucket by whole calendar days-until (Asia/
  // Kolkata), not a UTC-string compare of `dueDate` against a UTC "today"
  // plus a raw `Date.now()` diff -- see daysUntilIST's own doc comment for
  // why that silently shifted a day at the IST boundary and disagreed with
  // the card's own (also-buggy) computation. A missing/unparseable dueDate
  // now gets its own explicit "Date not set" bucket instead of silently
  // landing in Timely (stat cards still sum to items.length).
  const withDays    = items.map((r) => daysUntilIST(r.dueDate));
  const overdue     = withDays.filter((d) => d !== null && d < 0).length;
  const dueSoon     = withDays.filter((d) => d !== null && d >= 0 && d <= 30).length;
  const dateNotSet  = withDays.filter((d) => d === null).length;
  const timely      = Math.max(0, items.length - overdue - dueSoon - dateNotSet);

  // GAP-HR-CONFIRMATION-03: hr_admin/hr_officer/super_admin per m7-list-
  // routes.ts's own HR_ROLES for this endpoint -- keep in sync with that
  // list if it ever changes.
  const CONFIRMATIONS_ROLES = ["hr_admin", "hr_officer", "super_admin"];

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<span />}
      />
      {/* GAP-HR-CONFIRMATION-03: a 403 gets its own "Access restricted" card
          below via LoadErrorState -- showing the generic "Couldn't load"
          badge on top of that would contradict it (this isn't a transient
          failure, and there is nothing to retry). Every other error keeps
          the badge unchanged. */}
      {!(errored && status === 403) && (
        <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      )}

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statOnProbation")} value={errored ? null : items.length} />
        <StatCard icon="⏰" iconBg="var(--badbg, #fff1f0)" label={t("statOverdue")}       value={errored ? null : overdue} />
        <StatCard icon="📅" iconBg="var(--warnbg, #fffbe6)" label={t("statDueSoon")}      value={errored ? null : dueSoon} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statTimely")}       value={errored ? null : timely} />
        <StatCard icon="❔" iconBg="var(--bg, #f5f5f5)"      label={t("statDateNotSet")}   value={errored ? null : dateNotSet} />
      </StatGrid>

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <LoadErrorState
              result={{ status, errorMessage }}
              area="confirmations"
              backHref="/hr"
              requiredRoles={CONFIRMATIONS_ROLES}
            />
          </div>
        ) : (
          <div style={{ padding: 16 }}>
            <ProbationConfirmationList rows={items} hasMore={hasMore} />
          </div>
        )}
      </Card>
    </div>
  );
}
