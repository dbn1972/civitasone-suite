import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";

/**
 * POSH Act 2013, §16 — "contents of the complaint made under section 9,
 * the identity and addresses of the aggrieved woman, respondent and
 * witnesses, any information relating to conciliation and inquiry
 * proceedings, recommendations of the Internal Committee … shall not be
 * published, communicated or made known to the public, press and media
 * in any manner."
 *
 * Only HR admins, super_admins, and nominated ICC members
 * may access this page.  Even for them, complainantId and
 * respondentId are stripped from the client payload and the summary is
 * redacted for confidential cases.
 */
const ICC_ROLES = ["hr_admin", "super_admin", "icc_member"];

/**
 * Raw API shape — includes complainantId/respondentId for
 * internal transport only; they are NEVER forwarded to the client.
 */
type RawRow = {
  id: string;
  /**
   * @internal Stripped before render — POSH Act 2013, §16 forbids
   * exposing complainant identity.
   */
  complainantId: string;
  /**
   * @internal Stripped before render — POSH Act 2013, §16 forbids
   * exposing respondent identity.
   */
  respondentId?: string;
  summary: string;
  filedAt: string;
  status: string;
  confidential: boolean;
};

/** Client-safe row — no complainantId / respondentId. */
type Row = Omit<RawRow, "complainantId" | "respondentId"> & { caseRef: string };

async function getData(): Promise<LoaderResult<RawRow[]>> {
  return fetchJson<unknown, RawRow[]>("/api/v1/hrms/icc/complaints", [], {
    telemetryKey: "hr.icc",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RawRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function IccPage() {
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => ICC_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="ICC complaints (POSH Act)" requiredRoles={ICC_ROLES} />;
  }

  const t = await getTranslations("icc");
  const { data: rawItems, source } = await getData();
  const errored = source === "error";

  /*
   * POSH Act 2013 masking:
   * - complainantId and respondentId are destructured out and discarded.
   * - For rows with confidential === true the summary is replaced with
   *   an opaque case reference.
   */
  const items: Row[] = rawItems.map(({ complainantId, respondentId, ...r }) => {
    const caseRef = "ICC/" + r.id.slice(0, 8).toUpperCase();
    return {
      ...r,
      caseRef,
      summary: r.confidential
        ? `Confidential complaint — case ref: ${caseRef}`
        : r.summary,
    };
  });

  const hasConfidential = items.some((i) => i.confidential);

  const filed = items.filter((i) => i.status === "filed").length;
  const inquiry = items.filter((i) => i.status === "inquiry" || i.status === "under_inquiry").length;
  const closed = items.filter((i) => ["closed", "disposed", "withdrawn"].includes(i.status)).length;

  /*
   * Columns deliberately exclude complainantId and respondentId — even
   * though DataTable's filterable / exportable features can expose any
   * key present on the Row type, those fields are already stripped above
   * so they cannot leak through search, CSV export, or column ordering.
   * (POSH Act 2013, §16)
   */
  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "caseRef", label: t("colCaseRef") },
    { key: "summary", label: t("colSummary") },
    { key: "filedAt", label: t("colFiledDate") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />

      {/* Screen-reader announcement when confidential records are present */}
      {hasConfidential && (
        <div aria-live="polite" className="sr-only">
          Some records are redacted under POSH Act 2013 confidentiality requirements.
        </div>
      )}

      <StatGrid>
        <StatCard icon="⚖️" iconBg="#e6f0ff" label={t("statTotalComplaintsLabel")} value={errored ? null : items.length} />
        <StatCard icon="🔔" iconBg="#fffbe6" label={t("statFiledLabel")} value={errored ? null : filed} />
        <StatCard icon="🔍" iconBg="#fff1f0" label={t("statUnderInquiryLabel")} value={errored ? null : inquiry} />
        <StatCard icon="✅" iconBg="#e6f7f0" label={t("statDisposedLabel")} value={errored ? null : closed} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "icc" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="⚖️"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </main>
  );
}
