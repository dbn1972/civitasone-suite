import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getCatalogueProducts, getCatalogueRatesForProduct } from "../_data";
import { RatesProductPicker } from "./RatesProductPicker";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GAP-CATALOGUE-RATES-01: the rates API is per-product (productId required), so the page
 * offers a searchable product picker (RatesProductPicker, typeahead over the product search
 * endpoint) and lists that product's rate cards newest-first with the paise-correct amount
 * and an in-force marker.
 */
export default async function Page({ searchParams }: { searchParams?: { productId?: string } }) {
  const requested = searchParams?.productId;
  const productId = requested && UUID_RE.test(requested) ? requested : undefined;
  const products = await getCatalogueProducts();
  const rates = productId ? await getCatalogueRatesForProduct(productId) : null;
  // Seed the picker's label for a productId already in the URL (reload/share).
  const selectedLabel = productId ? products.data.find((p) => p.id === productId)?.label : undefined;
  return (
    <div className="page-main">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/catalogue">Service Catalogue</a>
      </nav>
      <ModuleListPage
        title="Catalogue — Rates"
        description={
          productId
            ? "Effective-dated rate cards for the selected product."
            : "Choose a product to see its effective-dated rate cards."
        }
        rows={rates ? rates.data : []}
        source={rates ? rates.source : products.source}
      >
        <RatesProductPicker
          {...(productId ? { initialProductId: productId } : {})}
          {...(selectedLabel ? { initialProductLabel: selectedLabel } : {})}
        />
        {requested && !productId ? <p role="alert">That product id is not valid.</p> : null}
      </ModuleListPage>
    </div>
  );
}
