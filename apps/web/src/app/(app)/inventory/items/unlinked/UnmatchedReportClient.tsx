"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, DataTable, EmptyState, RefreshErrorState, useToast } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { useFormError } from "@/lib/useFormError";
import { postItemLink, LINK_REFRESH_DELAY_MS } from "../../linkApi";
import { hasNoRows, type LinkSuggestionRow, type UnmatchedReport } from "../../linkHelpers";

/** Suggested exact matches (with a Confirm button per pair) and the two one-sided lists. */
export function UnmatchedReportClient({
  report, suggestions,
}: { report: UnmatchedReport; suggestions: LinkSuggestionRow[] | null }) {
  const t = useTranslations("inventoryLink");
  const router = useRouter();
  const { toast } = useToast();
  const formError = useFormError("item link");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function confirm(s: LinkSuggestionRow) {
    setBusyId(s.inventoryItemId);
    setMessage("");
    try {
      const res = await postItemLink(s.inventoryItemId, s.stockItemId, "suggested");
      if (!res.ok) {
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      toast.success(t("report.confirmed"));
      setTimeout(() => router.refresh(), LINK_REFRESH_DELAY_MS);
    } catch (caught) {
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusyId(null);
    }
  }

  // Plain string fields + `render` (this is a client component): DataTable draws strings, not elements, from row values.
  type SugRow = { id: string; sku: string; inventoryName: string; stock: string };
  type InvRow = { id: string; sku: string; name: string; suggested: string };
  type StockRow = { id: string; code: string; name: string; suggested: string };
  const suggestionRows: SugRow[] = (suggestions ?? []).map((s) => ({
    id: s.inventoryItemId, sku: s.sku, inventoryName: s.inventoryName, stock: `${s.stockCode} · ${s.stockName}`,
  }));
  const bySuggestionId = new Map((suggestions ?? []).map((s) => [s.inventoryItemId, s]));
  const invRows: InvRow[] = report.inventoryOnly.map((i) => ({
    id: i.id, sku: i.sku ?? "—", name: i.name, suggested: i.hasSuggestion ? t("report.yes") : t("report.none"),
  }));
  const stockRows: StockRow[] = (report.stockOnly ?? []).map((s) => ({
    id: s.id, code: s.code, name: s.name, suggested: s.hasSuggestion ? t("report.yes") : t("report.none"),
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 18 }}>
      {report.truncated ? <p role="status" style={{ margin: 0, fontSize: "0.875rem" }}>{t("report.truncated")}</p> : null}
      {!report.stockAvailable ? <p role="status" style={{ margin: 0, fontSize: "0.875rem", color: "#92400e" }}>{t("report.stockUnavailable")}</p> : null}
      <div role="status" aria-live="polite">
        {message ? <p role="alert" style={{ margin: 0, fontSize: "0.875rem", color: "#b91c1c" }}>{message}</p> : null}
      </div>

      <Card title={t("report.suggestionsHeading")}>
        {suggestions === null ? (
          <RefreshErrorState error={toHumanError("load", { area: t("report.suggestionsHeading") })} />
        ) : hasNoRows(suggestionRows) ? (
          <EmptyState icon="✅" title={t("report.noSuggestions")} message="" />
        ) : (
          <>
            <p className="sub pad" style={{ margin: 0 }}>{t("report.suggestionsHint")}</p>
            <DataTable<SugRow>
              columns={[
                { key: "sku", label: t("report.colSku") },
                { key: "inventoryName", label: t("report.colInventoryItem"), render: (r) => <Link href={`/inventory/items/${r.id}`}>{r.inventoryName}</Link> },
                { key: "stock", label: t("report.colStockItem") },
                {
                  key: "id", label: "", csvExclude: true,
                  render: (r) => {
                    const s = bySuggestionId.get(r.id);
                    return s ? (
                      <Button type="button" variant="secondary" disabled={busyId !== null} onClick={() => void confirm(s)}>
                        {t("report.confirm")}
                      </Button>
                    ) : null;
                  },
                },
              ]}
              rows={suggestionRows}
              pageSize={15}
            />
          </>
        )}
      </Card>

      <Card title={t("report.inventoryOnlyHeading")}>
        {hasNoRows(invRows) ? (
          <EmptyState icon="✅" title={t("report.noInventoryOnly")} message="" />
        ) : (
          <DataTable<InvRow>
            columns={[
              { key: "sku", label: t("report.colSku") },
              { key: "name", label: t("report.colName"), render: (r) => <Link href={`/inventory/items/${r.id}`}>{r.name}</Link> },
              { key: "suggested", label: t("report.colHasSuggestion") },
            ]}
            rows={invRows}
            sortable
            filterable
            pageSize={15}
          />
        )}
      </Card>

      {report.stockOnly === null ? null : (
        <Card title={t("report.stockOnlyHeading")}>
          {hasNoRows(stockRows) ? (
            <EmptyState icon="✅" title={t("report.noStockOnly")} message="" />
          ) : (
            <DataTable<StockRow>
              columns={[
                { key: "code", label: t("report.colCode") },
                { key: "name", label: t("report.colName"), render: (r) => <Link href={`/inventory/${r.id}`}>{r.name}</Link> },
                { key: "suggested", label: t("report.colHasSuggestion") },
              ]}
              rows={stockRows}
              sortable
              filterable
              pageSize={15}
            />
          )}
        </Card>
      )}
    </div>
  );
}
