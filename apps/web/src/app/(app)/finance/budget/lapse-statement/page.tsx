import { getTranslations } from "next-intl/server";
import { PageHeader, Card, DataTable, LoadErrorState } from "@/app/_components/ds";
import { currentFinancialYear, isValidFinancialYearLabel } from "@/lib/fiscalYear";
import { formatIndianDateTime } from "@/lib/formatters";
import { FyFilter } from "../../_components/FyFilter";
import { PrintExportButton } from "../../_components/PrintExportButton";
import { PrintHeader } from "../../_components/PrintHeader";
import { budgetHeadLabel } from "../_lib/headLabel";
import { formatClosedBy } from "../../period-close/periodHelpers";
import { getLapseStatement } from "./lapseStatement";

type Row = {
  id: string;
  head: string;
  beMinor: string;
  reappropriationNetMinor: string;
  reMinor: string;
  expenditureMinor: string;
  lapseMinor: string;
  excessMinor: string;
};

/**
 * fx-p3: Lapse statement (31 March). Head-wise final grant (BE +/- RE / supplementary / re-appropriation; the net
 * column is RE - BE) against ledger expenditure (net of reversals and recoveries, as Budget Monitoring);
 * whatever is unspent lapses on 31 March and is not carried forward (GFR). The statement is
 * provisional until the year-end close records it. Print-friendly: every row on one page plus a totals row.
 */
export default async function LapseStatementPage(props: { searchParams?: Promise<{ fy?: string }> }) {
  const searchParams = await props.searchParams;
  const t = await getTranslations("financeLapseStatement");
  const fy = typeof searchParams?.fy === "string" && isValidFinancialYearLabel(searchParams.fy) ? searchParams.fy : currentFinancialYear();
  const result = await getLapseStatement(fy);
  const statement = result.source === "error" ? null : result.data;

  const rows: Row[] = (statement?.rows ?? []).map((r, i) => ({
    id: r.headId || `${r.headCode}-${i}`,
    head: budgetHeadLabel({ headCode: r.headCode, headName: r.headName }),
    beMinor: r.beMinor,
    reappropriationNetMinor: r.reappropriationNetMinor,
    reMinor: r.reMinor,
    expenditureMinor: r.expenditureMinor,
    lapseMinor: r.lapseMinor,
    excessMinor: r.excessMinor,
  }));
  if (statement && rows.length > 0) {
    const tt = statement.totals;
    // Net re-appropriation total = final grant - BE, so the totals row adds up across.
    const netTotal = (BigInt(tt.reMinor) - BigInt(tt.beMinor)).toString();
    rows.push({
      id: "__total", head: t("total"), beMinor: tt.beMinor, reappropriationNetMinor: netTotal, reMinor: tt.reMinor,
      expenditureMinor: tt.expenditureMinor, lapseMinor: tt.lapseMinor, excessMinor: tt.excessMinor,
    });
  }

  const recorded = statement?.recorded ?? null;
  const recordedBy = recorded ? formatClosedBy(recorded.recordedBy, recorded.recordedByName ?? null).text : "";

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/finance/budget/formulation"
        actions={
          <>
            <FyFilter />
            <PrintExportButton label={t("print")} documentTitle={`${t("title")} FY ${fy}`} />
          </>
        }
      />
      <PrintHeader title={t("title")} scope={`FY ${fy}`} />

      <p style={{ margin: "0 0 12px", fontSize: 13.5 }}>{t("note")}</p>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink2)" }}>{t("expenditureNote")}</p>

      {result.source === "error" ? (
        <LoadErrorState result={result} area={t("area")} backHref="/finance" />
      ) : (
        <>
          <p role="status" className={recorded ? "pill good" : "pill warn"} style={{ width: "fit-content", marginBottom: 12 }}>
            {recorded
              ? t("recorded", { fy, at: formatIndianDateTime(recorded.recordedAt), by: recordedBy })
              : t("provisional", { fy })}
          </p>
          <Card title={t("cardTitle", { fy })}>
            <DataTable<Row>
              caption={t("caption", { fy })}
              columns={[
                { key: "head", label: t("colHead") },
                { key: "beMinor", label: t("colBe"), align: "right", cellType: "amount" },
                { key: "reappropriationNetMinor", label: t("colReapp"), align: "right", cellType: "amount" },
                { key: "reMinor", label: t("colFinal"), align: "right", cellType: "amount" },
                { key: "expenditureMinor", label: t("colExpenditure"), align: "right", cellType: "amount" },
                { key: "lapseMinor", label: t("colLapse"), align: "right", cellType: "amount" },
                { key: "excessMinor", label: t("colExcess"), align: "right", cellType: "amount" },
              ]}
              rows={rows}
              identifyingColumnKey="head"
              sortable={false}
              pageSize={10000}
              exportable
              exportAudit="finance/budget/lapse-statement"
              exportFilename={`lapse-statement-${fy}`}
              csvPlainAmounts
              emptyIcon="📄"
              emptyTitle={t("emptyTitle")}
              emptyMessage={t("emptyMessage", { fy })}
            />
          </Card>
        </>
      )}
    </div>
  );
}
