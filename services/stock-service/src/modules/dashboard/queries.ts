/**
 * Stock dashboard read model.
 *
 * GAP2-STOCK-DASHBOARD-02: each figure is produced by the owning module's own
 * query interface (item, valuation, ledger) and assembled here in JS. No single
 * SQL statement spans two module schemas (no cross-module correlated subquery),
 * so the DB-per-module boundary holds.
 *
 * GAP2-STOCK-DASHBOARD-01: inventoryValue is a bigint-paise STRING end-to-end;
 * it is never coerced through a JS Number (which would lose precision past
 * Number.MAX_SAFE_INTEGER paise).
 */
import * as itemRepo from "../item/repo.js";
import * as valuationRepo from "../valuation/repo.js";
import * as ledgerRepo from "../ledger/repo.js";

export async function getDashboard(tenantId: string) {
  // Each read touches only its own module's schema.
  const [items, valuation, grnsThisMonth] = await Promise.all([
    itemRepo.findReorderDescriptors(tenantId),
    valuationRepo.getTenantValuation(tenantId),
    ledgerRepo.countReceiptsThisMonth(tenantId),
  ]);

  const onHand = valuation.onHandByItem;

  let lowStockAlerts = 0;
  let stockOuts = 0;
  for (const it of items) {
    const qty = onHand.get(it.id) ?? 0;
    if (it.reorderLevel > 0 && qty < it.reorderLevel) lowStockAlerts += 1;
    if (it.isActive && qty <= 0) stockOuts += 1;
  }

  return {
    totalSKUs: items.length,
    lowStockAlerts,
    stockOuts,
    grnsThisMonth,
    // Bigint-paise string — never round-tripped through Number().
    inventoryValue: valuation.totalValuePaise,
  };
}
