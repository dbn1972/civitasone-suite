"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ItemPicker } from "@/app/_components/ItemPicker";
import { entryHref, type PickerEntry } from "../linkHelpers";

/**
 * Search the item master and the stock register together (GAP-INVENTORY-LIST-02). A linked
 * item appears once; choosing an item opens it. Items that exist in one master only stay
 * findable and are labelled as such.
 */
export function ItemFinder() {
  const t = useTranslations("inventoryLink");
  const router = useRouter();
  const [picked, setPicked] = useState<PickerEntry | null>(null);
  return (
    <div className="pad" style={{ maxWidth: 560 }}>
      <label className="l" htmlFor="inventory-item-finder">{t("finder.label")}</label>
      <ItemPicker
        id="inventory-item-finder"
        value={picked?.key ?? null}
        onChange={(entry) => {
          setPicked(entry);
          if (entry) router.push(entryHref(entry));
        }}
      />
      <p className="sub" style={{ margin: "4px 0 0", fontSize: "0.8125rem" }}>{t("finder.hint")}</p>
    </div>
  );
}
