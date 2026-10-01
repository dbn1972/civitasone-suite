import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getPayMatrix } from "../../../_data/loaders";
import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/formatters";

type Row = {
  id: string;
  level: string | number;
  cell: string | number;
  basicMinor: string;
  designations: string;
} & Record<string, unknown>;

export default async function PayMatrixPage({
  searchParams,
}: {
  searchParams?: { level?: string };
}) {
  const t = await getTranslations("payMatrix");
  // GAP-HR-PAY-MATRIX-04 fix step 3: an optional level filter, reusing the
  // API's own `?level=` param (already supported server-side) instead of
  // fetching and flattening all 541 rows just to narrow the view.
  const levelFilter = searchParams?.level ? Number(searchParams.level) : undefined;
  const { data: page, source, status, errorMessage } = await getPayMatrix(
    levelFilter && Number.isInteger(levelFilter) && levelFilter >= 1 && levelFilter <= 18 ? levelFilter : undefined,
  );
  const errored = source === "error";
  const levels = page.levels;

  const rows: Row[] = levels.flatMap((l) =>
    l.cells.map((c) => ({
      id: `${l.level}-${c.cell}`,
      level: l.level,
      cell: c.cell,
      basicMinor: c.basicMinor,
      // GAP-HR-PAY-MATRIX-04: the API already returns each level's posts
      // (designations); the page just never showed them, so there was no
      // way to tell which posts sit at a level.
      designations: l.designations?.length ? l.designations.map((d) => d.name).join(", ") : "—",
    })),
  );

  const levelCount = levels.length;
  const cellCount = rows.length;
  // GAP-HR-PAY-MATRIX-03: min/max used to be the first/last *flattened*
  // rows' already-formatted display strings -- correct only by accident,
  // while the API happens to return levels ascending. Now a real BigInt
  // comparison over every cell's basicMinor (paise), formatted once via
  // formatMoney -- correct regardless of API ordering or a level filter.
  const allMinor = rows.map((r) => BigInt(r.basicMinor || "0"));
  const minPay = allMinor.length ? formatMoney(allMinor.reduce((a, b) => (a < b ? a : b))) : "—";
  const maxPay = allMinor.length ? formatMoney(allMinor.reduce((a, b) => (a > b ? a : b))) : "—";

  const columns: { key: keyof Row & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "level", label: t("colLevel"), align: "right" },
    { key: "cell", label: t("colCell"), align: "right" },
    // GAP-HR-PAY-MATRIX-06: money used to be formatted server-side into a
    // display string ("₹ 18,000", inconsistent with the lookup route's own
    // "Rs " prefix) with basicMinor sent along but ignored. cellType:
    // "amount" formats the real paise value client-side via the shared
    // formatMoney -- same money-from-paise rule every other page follows,
    // and this column is now sortable/filterable on the real numeric value
    // (DataTable's own numeric-sort/filter support for cellType: "amount",
    // rather than comparing formatted text) instead of `sortable: false`.
    { key: "basicMinor", label: t("colBasicPay"), align: "right", cellType: "amount" },
    { key: "designations", label: t("colDesignations") },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel={t("backToHr")}
        actions={<span />}
      />
      {!errored ? <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} /> : null}
      {/* GAP-HR-PAY-MATRIX-01: this table is a computed approximation, not
          the notified 7th CPC matrix (see PAY_MATRIX_OFFICIAL in
          services/hrms-service/src/modules/pay-matrix/routes.ts) -- shown
          for as long as the backend reports official: false, so this label
          disappears on its own once the real table is loaded. */}
      {!errored && !page.official ? (
        <div
          role="note"
          style={{
            background: "var(--warnbg, #fffbe6)",
            border: "1px solid var(--warn-line, #f0d878)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            margin: "12px 0",
          }}
        >
          {t("computedNotOfficialNotice")}
        </div>
      ) : null}
      {!errored ? (
        // GAP-HR-PAY-MATRIX-04 fix step 3: a plain GET form (no client JS
        // needed -- the level filter is entirely server-driven via
        // searchParams) so a level can be picked directly instead of
        // scrolling/filtering through all 541 rows.
        <form method="get" style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0" }}>
          <label htmlFor="pay-matrix-level" style={{ fontSize: 13, color: "var(--mut)" }}>
            {t("levelFilterLabel")}
          </label>
          <select id="pay-matrix-level" name="level" defaultValue={levelFilter ?? ""} style={{ minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", padding: "0 8px" }}>
            <option value="">{t("levelFilterAll")}</option>
            {Array.from({ length: 18 }, (_, i) => i + 1).map((lvl) => (
              <option key={lvl} value={lvl}>{lvl}</option>
            ))}
          </select>
          <button type="submit" className="btn ghost" style={{ minHeight: 36 }}>{t("levelFilterApply")}</button>
        </form>
      ) : null}
      <StatGrid>
        <StatCard icon="📊" iconBg="var(--infobg, #e6f0ff)" label={t("statPayLevelsLabel")} value={errored ? null : levelCount} />
        <StatCard icon="🗂️" iconBg="var(--bg, #f5f5f5)" label={t("statTotalCellsLabel")} value={errored ? null : cellCount} />
        <StatCard icon="💰" iconBg="var(--warnbg, #fffbe6)" label={t("statMinBasicPayLabel")} value={errored ? null : minPay} />
        <StatCard icon="💎" iconBg="var(--goodbg, #e6f7f0)" label={t("statMaxBasicPayLabel")} value={errored ? null : maxPay} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          // GAP-HR-PAY-MATRIX-02: this page used to always render the
          // generic retryable RefreshErrorState, even on a 403 -- an
          // employee/manager/payroll_officer denied by the backend's
          // READER_ROLES (which the /hr layout itself doesn't mirror) saw
          // "couldn't load, try again" with a Retry button that could never
          // succeed. LoadErrorState renders the same access-restricted
          // message (no retry) the rest of the app already uses for a 403.
          <div className="pad">
            <LoadErrorState result={{ status, errorMessage }} area="pay matrix" backHref="/hr" />
          </div>
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={20}
            emptyIcon="📊"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </div>
  );
}
