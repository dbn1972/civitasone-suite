import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, LoadErrorState, StatusPill, DataTable, EmptyState, Card } from "@/app/_components/ds";
import { INVENTORY_ITEM_LINK_ROLES, getSessionRoles } from "@/lib/auth/roleGuard";
import { formatMoney } from "@/lib/formatters";
import { getInventoryItemDetail, getItemStockLink } from "../../_dataLinks";
import { getInventoryLedgerSource, getInventoryItemBalances } from "../../_dataLedger";
import { getInventoryStoreOptions } from "../../_data";
import { balanceTotals, hasNoRows } from "../../linkHelpers";
import { ItemLinkActions } from "./ItemLinkActions";

export const dynamic = "force-dynamic";

const WAREHOUSE_COLUMNS = (t: (k: string) => string) => [
  { key: "warehouse" as const, label: t("detail.warehouse") },
  { key: "qty" as const, label: t("detail.qty"), align: "right" as const },
  { key: "rate" as const, label: t("detail.rate"), align: "right" as const },
  { key: "value" as const, label: t("detail.value"), align: "right" as const },
];

/**
 * Item master detail (GAP-INVENTORY-DETAIL-04 / GAP-INVENTORY-LIST-02): the inventory item and,
 * when it is linked to a stock register item, that item's stock-side balances on the same page --
 * so the two masters read as ONE item. An unlinked item says so plainly and, for admins, offers the
 * exact-code suggestion or a manual link.
 */
export default async function InventoryItemDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const t = await getTranslations("inventoryLink");
  // Tenants on the inventory ledger hold stock here, not in the stock register: show balances per store
  // instead of a stock-register link (which they have none of). Anything else keeps the link card.
  const ledger = await getInventoryLedgerSource();
  const fromInventory = ledger.source !== "error" && ledger.data === "inventory";
  const tl = fromInventory ? await getTranslations("inventoryLedger") : null;
  const [itemRes, linkRes, balancesRes, storesRes] = await Promise.all([
    getInventoryItemDetail(params.id),
    fromInventory ? Promise.resolve({ data: null, source: "api" } as Awaited<ReturnType<typeof getItemStockLink>>) : getItemStockLink(params.id),
    fromInventory ? getInventoryItemBalances(params.id) : Promise.resolve(null),
    fromInventory ? getInventoryStoreOptions() : Promise.resolve(null),
  ]);
  const storeName = new Map((storesRes?.data ?? []).map((s) => [s.id, s.name]));
  const storeRows = (balancesRes?.data ?? []).map((b) => ({
    id: b.storeId,
    store: storeName.get(b.storeId) ?? b.storeId.slice(0, 8),
    qty: b.onHandQty.toLocaleString("en-IN"),
    value: formatMoney(b.valueMinor),
  }));
  const totalQty = (balancesRes?.data ?? []).reduce((n, b) => n + b.onHandQty, 0);
  let totalValue = 0n;
  for (const b of balancesRes?.data ?? []) { try { totalValue += BigInt(b.valueMinor); } catch { /* skip an unparseable value */ } }

  if (itemRes.source === "error" && itemRes.status !== 404) {
    return (
      <>
        <PageHeader title={t("detail.heading")} back="/inventory/items" />
        <LoadErrorState result={itemRes} area="item" backHref="/inventory/items" />
      </>
    );
  }
  const item = itemRes.data;
  if (!item) {
    return (
      <>
        <PageHeader title={t("detail.itemNotFound")} back="/inventory/items" />
        <p className="sub">
          {t("detail.itemNotFoundBody")} <Link href="/inventory/items">{t("detail.browseItems")}</Link>
        </p>
      </>
    );
  }

  const canManage = getSessionRoles().some((r) => INVENTORY_ITEM_LINK_ROLES.includes(r));
  const detail = linkRes.data;
  const linkFailed = linkRes.source === "error" || detail === null;
  const totals = balanceTotals(detail?.stock?.balances ?? null);
  const warehouseRows = (detail?.stock?.balances?.warehouses ?? []).map((w) => ({
    id: w.warehouseId,
    warehouse: w.warehouseId.slice(0, 8),
    qty: w.qty.toLocaleString("en-IN"),
    rate: formatMoney(w.rateMinor),
    value: formatMoney(w.valueMinor),
  }));

  return (
    <>
      <PageHeader
        title={<>{item.sku ? `${item.sku} · ` : ""}{item.name} <StatusPill status={item.status} /></>}
        back="/inventory/items"
        actions={canManage ? <Link href="/inventory/items/unlinked" className="btn">{t("detail.unlinkedItemsReport")}</Link> : undefined}
      />
      <div className="grid g-main" style={{ alignItems: "start" }}>
        {fromInventory && tl ? (
          <Card title={tl("item.heading")}>
            <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {balancesRes === null || balancesRes.source === "error" ? (
                <LoadErrorState result={balancesRes ?? { data: [], source: "error" as const }} area="stock on hand" />
              ) : (
                <>
                  <div className="fields">
                    <div className="fld"><div className="l">{tl("item.onHand")}</div><div className="v">{totalQty.toLocaleString("en-IN")}</div></div>
                    <div className="fld"><div className="l">{tl("item.value")}</div><div className="v">{formatMoney(totalValue)}</div></div>
                  </div>
                  {storeRows.length === 0 ? (
                    <EmptyState icon="📦" title={tl("item.noBalances")} message="" />
                  ) : (
                    <DataTable
                      columns={[
                        { key: "store" as const, label: tl("item.store") },
                        { key: "qty" as const, label: tl("item.qty"), align: "right" as const },
                        { key: "value" as const, label: tl("item.value"), align: "right" as const },
                      ]}
                      rows={storeRows}
                      pageSize={10}
                    />
                  )}
                </>
              )}
            </div>
          </Card>
        ) : (
        <Card title={t("detail.heading")}>
          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {linkFailed ? (
              <LoadErrorState result={linkRes} area="stock register link" />
            ) : detail.linked && detail.link ? (
              <>
                <p style={{ margin: 0 }}>
                  <StatusPill status="active" label={t("badge.linked")} />{" "}
                  {t("detail.linkedTo", { code: detail.link.stockItemCode, name: detail.link.stockItemName })}
                </p>
                <p style={{ margin: 0 }}>
                  <Link href={`/inventory/${detail.link.stockItemId}`}>{t("detail.openStock")}</Link>
                </p>
                {!detail.stockAvailable ? (
                  <p role="status" style={{ margin: 0, fontSize: "0.875rem", color: "var(--warn)" }}>{t("detail.stockUnavailable")}</p>
                ) : totals ? (
                  <>
                    <div className="fields">
                      <div className="fld"><div className="l">{t("detail.onHand")}</div><div className="v">{totals.qty.toLocaleString("en-IN")}</div></div>
                      <div className="fld"><div className="l">{t("detail.stockValue")}</div><div className="v">{formatMoney(totals.valueMinor)}</div></div>
                    </div>
                    {hasNoRows(warehouseRows) ? (
                      <EmptyState icon="📦" title={t("detail.noBalances")} message="" />
                    ) : (
                      <>
                        <h4 style={{ margin: "8px 0 0" }}>{t("detail.byWarehouse")}</h4>
                        <DataTable columns={WAREHOUSE_COLUMNS(t)} rows={warehouseRows} pageSize={10} />
                      </>
                    )}
                  </>
                ) : null}
              </>
            ) : (
              <p style={{ margin: 0 }}>
                <StatusPill status="info" label={t("badge.unlinked")} /> {t("detail.notLinked")}
              </p>
            )}
            {canManage && !linkFailed ? (
              <ItemLinkActions inventoryItemId={item.id} link={detail.link} suggestion={detail.suggestion} />
            ) : null}
          </div>
        </Card>
        )}
        <Card title={item.name}>
          <div className="fields pad">
            <div className="fld"><div className="l">{t("detail.sku")}</div><div className="v">{item.sku ?? "—"}</div></div>
            <div className="fld"><div className="l">{t("detail.category")}</div><div className="v">{item.category ?? "—"}</div></div>
            <div className="fld"><div className="l">{t("detail.unit")}</div><div className="v">{item.uom ?? "—"}</div></div>
            <div className="fld"><div className="l">{t("detail.type")}</div><div className="v">{item.itemType}</div></div>
            <div className="fld"><div className="l">{t("detail.reorderLevel")}</div><div className="v">{item.reorderLevel.toLocaleString("en-IN")}</div></div>
            <div className="fld"><div className="l">{t("detail.reorderQty")}</div><div className="v">{item.reorderQty.toLocaleString("en-IN")}</div></div>
            <div className="fld"><div className="l">{t("detail.stdCost")}</div><div className="v">{formatMoney(item.unitCostMinor)}</div></div>
            <div className="fld"><div className="l">{t("detail.hsn")}</div><div className="v">{item.hsnCode ?? "—"}</div></div>
          </div>
        </Card>
      </div>
    </>
  );
}
