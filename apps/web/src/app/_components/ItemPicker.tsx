"use client";

import { useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button, EntityPicker, type EntityOption } from "./ds";
import { searchItemEntries, type ItemMasters } from "@/lib/entityAdapters/item";
import type { PickerEntry } from "@/app/(app)/inventory/linkHelpers";

export interface ItemPickerProps {
  /** Key of the chosen entry (inventory id for a linked / inventory-only item, stock id for a stock-only one). */
  value: string | null;
  /** The whole entry, so a caller can use whichever side it needs (inventoryItemId / stockItemId). Null when cleared. */
  onChange: (entry: PickerEntry | null) => void;
  /** An entry the caller already has (skips a lookup for a preselected item). */
  initialEntry?: PickerEntry;
  /** "stock" keeps only items that exist on the stock side (stock-entry forms). */
  masters?: ItemMasters;
  /** Keep only these kinds (e.g. only unlinked stock items when choosing what to link). */
  kinds?: ReadonlyArray<PickerEntry["kind"]>;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  clearable?: boolean;
}

/**
 * ONE item picker over both item masters. A linked inventory/stock pair is shown as a single
 * item (code, name and a "Linked" sublabel); items that exist in only one master stay visible and
 * say so. The id never has to be typed or read by a person.
 */
export function ItemPicker({
  value, onChange, initialEntry, masters = "all", kinds, placeholder, disabled, id, "aria-label": ariaLabel, clearable = false,
}: ItemPickerProps) {
  const t = useTranslations("inventoryLink");
  const known = useRef<Map<string, PickerEntry>>(new Map(initialEntry ? [[initialEntry.key, initialEntry]] : []));

  const toOption = useCallback((e: PickerEntry): EntityOption => ({
    id: e.key,
    label: `${e.code} · ${e.name}`,
    sublabel: t(`kind.${e.kind}`),
  }), [t]);

  const search = useCallback(async (query: string, signal: AbortSignal) => {
    const entries = (await searchItemEntries(query, signal, masters)).filter((e) => !kinds || kinds.includes(e.kind));
    for (const e of entries) known.current.set(e.key, e);
    return entries.map(toOption);
  }, [masters, kinds, toOption]);

  const picker = (
    <EntityPicker
      value={value}
      onChange={(v) => {
        const key = (Array.isArray(v) ? v[0] : v) ?? null;
        onChange(key ? known.current.get(key) ?? null : null);
      }}
      search={search}
      initialOptions={initialEntry ? [toOption(initialEntry)] : undefined}
      placeholder={placeholder ?? t("picker.placeholder")}
      searchingText={t("picker.searching")}
      noResultsText={t("picker.noResults")}
      disabled={disabled}
      id={id}
      aria-label={ariaLabel ?? t("picker.ariaLabel")}
    />
  );

  if (!clearable) return picker;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>{picker}</div>
      {value && (
        <Button type="button" variant="secondary" style={{ minHeight: 44 }} aria-label={t("picker.clearAriaLabel")} disabled={disabled} onClick={() => onChange(null)}>
          {t("picker.clear")}
        </Button>
      )}
    </div>
  );
}
