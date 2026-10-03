import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, StatusPill } from "@/app/_components/ds";
import { INVENTORY_ITEM_LINK_ROLES, getSessionRoles } from "@/lib/auth/roleGuard";
import { getInventoryItemDetail, getItemLinkByStock } from "./_dataLinks";

/**
 * On the stock register item page: the item master entry this item is linked to (so the two
 * masters read as one item), or a plain "not linked" note. A failed link read says so instead of
 * claiming the item is unlinked (GAP-INVENTORY-DETAIL-04).
 */
export async function RegisterLinkCard({ stockItemId }: { stockItemId: string }) {
  const t = await getTranslations("inventoryLink");
  const canManage = getSessionRoles().some((r) => INVENTORY_ITEM_LINK_ROLES.includes(r));
  const linkRes = await getItemLinkByStock(stockItemId);

  let body: React.ReactNode;
  if (linkRes.source === "error") {
    body = <p role="status" style={{ margin: 0, color: "#92400e" }}>{t("register.unavailable")}</p>;
  } else if (linkRes.data === null) {
    body = (
      <p style={{ margin: 0 }}>
        <StatusPill status="info" label={t("badge.unlinked")} /> {t("register.notLinked")}{" "}
        {canManage ? <Link href="/inventory/items/unlinked">{t("register.review")}</Link> : null}
      </p>
    );
  } else {
    const link = linkRes.data;
    const inv = await getInventoryItemDetail(link.inventoryItemId);
    const code = inv.data?.sku ?? link.stockItemCode;
    const name = inv.data?.name ?? link.stockItemName;
    body = (
      <p style={{ margin: 0 }}>
        <StatusPill status="active" label={t("badge.linked")} /> {t("register.linkedTo", { code, name })}{" "}
        <Link href={`/inventory/items/${link.inventoryItemId}`}>{t("register.openItem")}</Link>
      </p>
    );
  }
  return (
    <Card title={t("register.heading")}>
      <div className="pad">{body}</div>
    </Card>
  );
}
