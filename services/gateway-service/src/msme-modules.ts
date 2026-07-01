/**
 * MSME sector-based module manifest.
 *
 * When a tenant's edition is "small_office" and settings.msme.sector is set,
 * this manifest determines which modules are enabled WITHOUT requiring explicit
 * admin-service module configuration. This is the "out-of-the-box" experience
 * for newly onboarded MSMEs.
 *
 * The admin-service module list (if configured) takes PRECEDENCE over this
 * manifest — it's the override layer. This is the default layer.
 */

export type MsmeSector = "manufacturing" | "trading" | "services";

/**
 * Module keys that each MSME sector gets out of the box.
 * Keys must match ROUTE_TO_MODULE values in module-guard.ts.
 */
export const MSME_SECTOR_MODULES: Record<MsmeSector, ReadonlySet<string>> = {
  manufacturing: new Set([
    "finance",       // invoicing, GST, cashbook, bank recon
    "procurement",   // purchase orders, GRN, vendor bills
    "stock",         // raw material, WIP, finished goods
    "inventory",     // valuation, reorder
    "payroll",       // factory workers, PF/ESI/TDS
    "assets",        // plant & machinery register
    "billing",       // customer invoicing
    "reports",       // P&L, balance sheet, stock valuation
    "crm",           // optional but included (B2B customers)
    "workflow",      // simple approval (owner approves PO)
    "helpdesk",      // internal support/maintenance tickets
  ]),

  trading: new Set([
    "finance",       // invoicing, GST, cashbook, bank recon
    "procurement",   // purchase orders, vendor bills
    "stock",         // buy → store → sell
    "inventory",     // stock levels, reorder points
    "billing",       // customer invoicing, credit notes
    "payroll",       // basic (few staff)
    "crm",           // leads, customers, follow-ups (CRITICAL for trading)
    "reports",       // profit margins, debtor aging, stock valuation
    "workflow",      // simple approval
    "helpdesk",      // customer queries
  ]),

  services: new Set([
    "finance",       // invoicing, GST, bank recon
    "billing",       // time-based / milestone invoicing
    "payroll",       // full HR (employees are the product)
    "crm",           // client pipeline (CRITICAL for services)
    "projects",      // project management, time tracking
    "contracts",     // client agreements, SOWs
    "reports",       // project profitability, utilisation, revenue
    "workflow",      // project approval, leave approval
    "helpdesk",      // client support tickets
    "knowledge",     // internal wiki / knowledge base
  ]),
};

/** All valid MSME sector strings. */
export const MSME_SECTORS: readonly string[] = ["manufacturing", "trading", "services"];

/**
 * Resolve modules for an MSME tenant based on their sector.
 * Returns null if the tenant is not an MSME (no msme.sector in settings).
 */
export function resolveMsmeModules(settings: Record<string, unknown> | null | undefined): Set<string> | null {
  if (!settings) return null;
  const msme = settings.msme as { sector?: string } | undefined;
  if (!msme?.sector) return null;
  const sector = msme.sector as MsmeSector;
  return MSME_SECTOR_MODULES[sector] ? new Set(MSME_SECTOR_MODULES[sector]) : null;
}
