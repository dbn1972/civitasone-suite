"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EntityPicker } from "@/app/_components/ds";
import { searchCatalogueProducts, resolveCatalogueProducts } from "@/lib/entityAdapters/catalogueProduct";

/**
 * GAP-CATALOGUE-RATES-01: searchable product picker for the rates page.
 *
 * The rates API is per-product (productId required), so the page needs a
 * product selector. This replaces the plain whole-catalogue <select> with a
 * typeahead over catalogue-service's existing product search
 * (GET /v1/catalogue/products?search=…), navigating to ?productId=<uuid> on
 * selection so the server component then lists that product's effective-dated,
 * paise-correct, in-force rate cards. `initialProduct` seeds the picker's label
 * when a productId is already in the URL (e.g. on reload/share).
 */
export function RatesProductPicker({
  initialProductId,
  initialProductLabel,
}: {
  initialProductId?: string;
  initialProductLabel?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [productId, setProductId] = useState<string | null>(initialProductId ?? null);

  function onChange(value: string | string[] | null) {
    const id = Array.isArray(value) ? (value[0] ?? null) : value;
    setProductId(id);
    startTransition(() => {
      router.push(id ? `/catalogue/rates?productId=${encodeURIComponent(id)}` : "/catalogue/rates");
    });
  }

  return (
    <div style={{ maxWidth: 360 }}>
      <label htmlFor="rates-product" style={{ fontSize: 13, display: "block", marginBottom: 4 }}>
        Product
      </label>
      <EntityPicker
        id="rates-product"
        value={productId}
        onChange={onChange}
        search={searchCatalogueProducts}
        resolve={resolveCatalogueProducts}
        {...(initialProductId && initialProductLabel
          ? { initialOptions: [{ id: initialProductId, label: initialProductLabel }] }
          : {})}
        disabled={pending}
        minQueryLength={1}
        aria-label="Product"
        placeholder="Search product by name…"
      />
    </div>
  );
}
