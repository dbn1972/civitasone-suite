import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getCatalogueProducts, getCatalogueRatesForProduct } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GAP-CATALOGUE-RATES-01: the rates API is per-product (productId required), so the page
 * offers a product picker (plain GET form, no client JS) and lists that product's rate
 * cards newest-first with the paise-correct amount and an in-force marker.
 */
export default async function Page({ searchParams }: { searchParams?: { productId?: string } }) {
  const requested = searchParams?.productId;
  const productId = requested && UUID_RE.test(requested) ? requested : undefined;
  const products = await getCatalogueProducts();
  const rates = productId ? await getCatalogueRatesForProduct(productId) : null;
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
        <form method="get" className="form-inline" aria-label="Select product">
          <label htmlFor="rates-product">Product</label>{" "}
          <select id="rates-product" name="productId" defaultValue={productId ?? ""}>
            <option value="" disabled>
              Select a product
            </option>
            {products.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>{" "}
          <button type="submit">Show rates</button>
        </form>
        {requested && !productId ? <p role="alert">That product id is not valid.</p> : null}
      </ModuleListPage>
    </div>
  );
}
