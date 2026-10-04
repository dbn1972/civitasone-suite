"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton, Button, useToast } from "@/app/_components/ds";
import { ItemPicker } from "@/app/_components/ItemPicker";
import { useFormError } from "@/lib/useFormError";
import { deleteItemLink, postItemLink, LINK_REFRESH_DELAY_MS } from "../../linkApi";
import type { ItemLinkRow, LinkSuggestion, PickerEntry } from "../../linkHelpers";

/**
 * Admin controls on the item master detail page: confirm the exact-code suggestion, link by hand
 * to a not-yet-linked stock register item, or remove an existing link. Rendered only for roles
 * the service lets through (INVENTORY_ITEM_LINK_ROLES). Removing a link never touches either item.
 */
export function ItemLinkActions({
  inventoryItemId, link, suggestion,
}: { inventoryItemId: string; link: ItemLinkRow | null; suggestion: LinkSuggestion | null }) {
  const t = useTranslations("inventoryLink");
  const router = useRouter();
  const { toast } = useToast();
  const formError = useFormError("item link");
  const [picked, setPicked] = useState<PickerEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function refreshSoon() {
    setTimeout(() => router.refresh(), LINK_REFRESH_DELAY_MS);
  }

  async function submitLink(stockItemId: string, source: "manual" | "suggested") {
    setBusy(true);
    setMessage("");
    try {
      const res = await postItemLink(inventoryItemId, stockItemId, source);
      if (!res.ok) {
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      toast.success(t("detail.linkQueued"));
      setPicked(null);
      refreshSoon();
    } catch (caught) {
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeLink(id: string) {
    const res = await deleteItemLink(id);
    if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
  }

  if (link) {
    return (
      <ActionButton
        label={t("detail.unlink")}
        confirmTitle={t("detail.unlinkTitle")}
        confirmDescription={t("detail.unlinkBody")}
        confirmLabel={t("detail.unlink")}
        danger
        onConfirm={() => removeLink(link.id)}
        onSuccess={() => {
          toast.success(t("detail.unlinkQueued"));
          refreshSoon();
        }}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {suggestion ? (
        <div role="group" aria-label={t("detail.suggestionTitle")} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
          <strong>{t("detail.suggestionTitle")}</strong>
          <p style={{ margin: "4px 0 8px", fontSize: "0.875rem" }}>
            {t("detail.suggestionBody", { code: suggestion.stockItemCode, name: suggestion.stockItemName })}
          </p>
          <Button type="button" disabled={busy} onClick={() => void submitLink(suggestion.stockItemId, "suggested")}>
            {t("detail.confirmLink")}
          </Button>
        </div>
      ) : null}
      <div>
        <label className="l" htmlFor="item-link-picker">{t("detail.chooseLabel")}</label>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ItemPicker
              id="item-link-picker"
              value={picked?.key ?? null}
              onChange={setPicked}
              masters="stock"
              kinds={["stock_only"]}
              placeholder={t("detail.choosePlaceholder")}
              disabled={busy}
            />
          </div>
          <Button type="button" variant="secondary" style={{ minHeight: 44 }} disabled={busy || !picked?.stockItemId} onClick={() => picked?.stockItemId && void submitLink(picked.stockItemId, "manual")}>
            {t("detail.linkAction")}
          </Button>
        </div>
      </div>
      <div role="status" aria-live="polite">
        {message ? <p role="alert" style={{ margin: 0, fontSize: "0.875rem", color: "#b91c1c" }}>{message}</p> : null}
      </div>
    </div>
  );
}
