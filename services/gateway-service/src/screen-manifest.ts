/**
 * Screen manifest — tells the frontend which sidebar items, dashboard widgets,
 * and terminology to render based on the tenant's edition + MSME sector.
 *
 * Endpoint: GET /api/v1/config/screens (called once at app load, cached by frontend)
 */
import type { FastifyInstance } from "fastify";
import { MSME_SECTOR_MODULES, resolveMsmeModules, type MsmeSector } from "./msme-modules.js";

export type SidebarItem = {
  key: string;
  label: string;
  icon: string;
  path: string;
};

export type DashboardWidget = {
  key: string;
  label: string;
  size: "sm" | "md" | "lg";
};

export type ScreenManifest = {
  edition: string;
  sector: string | null;
  sidebar: SidebarItem[];
  dashboardWidgets: DashboardWidget[];
  terminology: Record<string, string>;
  features: Record<string, boolean>;
};

// ── Sidebar definitions per MSME sector ──────────────────────────────────────

const MANUFACTURING_SIDEBAR: SidebarItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "layout-dashboard", path: "/" },
  { key: "sales", label: "Sales & Invoices", icon: "receipt", path: "/sales" },
  { key: "purchase", label: "Purchases", icon: "shopping-cart", path: "/purchase" },
  { key: "production", label: "Production", icon: "settings-2", path: "/production" },
  { key: "stock", label: "Stock & Materials", icon: "package", path: "/stock" },
  { key: "dispatch", label: "Dispatch", icon: "truck", path: "/dispatch" },
  { key: "gst", label: "GST", icon: "file-invoice", path: "/gst" },
  { key: "payroll", label: "Payroll", icon: "wallet", path: "/payroll" },
  { key: "assets", label: "Assets", icon: "tool", path: "/assets" },
  { key: "bank", label: "Banking", icon: "building-bank", path: "/bank" },
  { key: "reports", label: "Reports", icon: "chart-bar", path: "/reports" },
  { key: "settings", label: "Settings", icon: "settings", path: "/settings" },
];

const TRADING_SIDEBAR: SidebarItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "layout-dashboard", path: "/" },
  { key: "sales", label: "Sales", icon: "receipt", path: "/sales" },
  { key: "purchase", label: "Purchases", icon: "shopping-cart", path: "/purchase" },
  { key: "stock", label: "Stock", icon: "package", path: "/stock" },
  { key: "crm", label: "Customers", icon: "users", path: "/crm" },
  { key: "gst", label: "GST & Tax", icon: "file-invoice", path: "/gst" },
  { key: "bank", label: "Banking", icon: "building-bank", path: "/bank" },
  { key: "payroll", label: "Payroll", icon: "wallet", path: "/payroll" },
  { key: "reports", label: "Reports", icon: "chart-bar", path: "/reports" },
  { key: "settings", label: "Settings", icon: "settings", path: "/settings" },
];

const SERVICES_SIDEBAR: SidebarItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "layout-dashboard", path: "/" },
  { key: "projects", label: "Projects", icon: "briefcase", path: "/projects" },
  { key: "crm", label: "Clients", icon: "users", path: "/crm" },
  { key: "invoicing", label: "Invoicing", icon: "receipt", path: "/invoicing" },
  { key: "hr", label: "Team", icon: "user-group", path: "/hr" },
  { key: "payroll", label: "Payroll", icon: "wallet", path: "/payroll" },
  { key: "contracts", label: "Contracts", icon: "file-text", path: "/contracts" },
  { key: "gst", label: "GST & Tax", icon: "file-invoice", path: "/gst" },
  { key: "bank", label: "Banking", icon: "building-bank", path: "/bank" },
  { key: "reports", label: "Reports", icon: "chart-bar", path: "/reports" },
  { key: "settings", label: "Settings", icon: "settings", path: "/settings" },
];

// ── Dashboard widgets per sector ─────────────────────────────────────────────

const MANUFACTURING_WIDGETS: DashboardWidget[] = [
  { key: "orders_received", label: "Orders Received", size: "sm" },
  { key: "production_status", label: "Production Status", size: "md" },
  { key: "stock_levels", label: "Stock Levels", size: "sm" },
  { key: "dispatch_pending", label: "Dispatch Pending", size: "sm" },
  { key: "receivable_aging", label: "Receivables", size: "md" },
  { key: "gst_due", label: "GST Due Dates", size: "sm" },
];

const TRADING_WIDGETS: DashboardWidget[] = [
  { key: "sales_today", label: "Today's Sales", size: "sm" },
  { key: "purchase_due", label: "Purchases Due", size: "sm" },
  { key: "receivable_overdue", label: "Overdue Receivables", size: "md" },
  { key: "stock_alerts", label: "Low Stock Alerts", size: "sm" },
  { key: "gst_liability", label: "GST Liability", size: "md" },
  { key: "cash_flow", label: "Cash Flow", size: "lg" },
];

const SERVICES_WIDGETS: DashboardWidget[] = [
  { key: "active_projects", label: "Active Projects", size: "md" },
  { key: "pending_invoices", label: "Pending Invoices", size: "sm" },
  { key: "receivable_aging", label: "Receivable Aging", size: "md" },
  { key: "team_utilisation", label: "Team Utilisation", size: "sm" },
  { key: "revenue_mtd", label: "Revenue (MTD)", size: "sm" },
  { key: "gst_due", label: "GST Due Dates", size: "sm" },
];

// ── Terminology per sector ───────────────────────────────────────────────────

const MANUFACTURING_TERMS: Record<string, string> = {
  invoice: "Invoice / Tax Invoice",
  customer: "Customer / Buyer",
  purchase: "Raw Material Purchase",
  stock: "Inventory / Materials",
  employee: "Worker / Staff",
  payment: "Payment Received",
  supplier: "Supplier / Vendor",
};

const TRADING_TERMS: Record<string, string> = {
  invoice: "Sales Invoice",
  customer: "Customer",
  purchase: "Purchase",
  stock: "Stock / Inventory",
  employee: "Staff",
  payment: "Payment",
  supplier: "Supplier",
};

const SERVICES_TERMS: Record<string, string> = {
  invoice: "Invoice",
  customer: "Client",
  purchase: "Vendor Bill",
  stock: "—",
  employee: "Team Member",
  payment: "Client Payment",
  supplier: "Vendor / Subcontractor",
  project: "Project / Engagement",
};

// ── Resolver ─────────────────────────────────────────────────────────────────

function resolveManifest(edition: string, settings: Record<string, unknown> | null): ScreenManifest {
  const msme = (settings?.msme ?? null) as { sector?: string; category?: string } | null;
  const sector = (msme?.sector ?? null) as MsmeSector | null;

  if (edition === "small_office" && sector) {
    switch (sector) {
      case "manufacturing":
        return {
          edition, sector,
          sidebar: MANUFACTURING_SIDEBAR,
          dashboardWidgets: MANUFACTURING_WIDGETS,
          terminology: MANUFACTURING_TERMS,
          features: { eWayBill: true, production: true, quality: true, dispatch: true, treds: true },
        };
      case "trading":
        return {
          edition, sector,
          sidebar: TRADING_SIDEBAR,
          dashboardWidgets: TRADING_WIDGETS,
          terminology: TRADING_TERMS,
          features: { eWayBill: true, production: false, quality: false, dispatch: true, treds: true },
        };
      case "services":
        return {
          edition, sector,
          sidebar: SERVICES_SIDEBAR,
          dashboardWidgets: SERVICES_WIDGETS,
          terminology: SERVICES_TERMS,
          features: { eWayBill: false, production: false, quality: false, dispatch: false, treds: false, projects: true, timeTracking: true },
        };
      default:
        break;
    }
  }

  // Fallback for non-MSME or unrecognized sector → generic small office
  return {
    edition, sector: null,
    sidebar: TRADING_SIDEBAR, // trading is the most generic
    dashboardWidgets: TRADING_WIDGETS,
    terminology: TRADING_TERMS,
    features: {},
  };
}

// ── Route registration ───────────────────────────────────────────────────────

export function registerScreenManifestRoute(app: FastifyInstance): void {
  /**
   * GET /api/v1/config/screens
   * Returns the screen manifest for the authenticated tenant.
   * Called once at app load; frontend caches the response.
   */
  app.get("/api/v1/config/screens", async (req, reply) => {
    const tenantId = req.headers["x-tenant-id"] as string | undefined;
    if (!tenantId) {
      return reply.code(401).send({ code: "UNAUTHENTICATED", message: "no tenant context" });
    }

    // Fetch tenant info (edition + settings) from admin/tenant service
    const tenantUrl = process.env.GATEWAY_TENANT_URL ?? "http://127.0.0.1:3002";
    let edition = "small_office";
    let settings: Record<string, unknown> | null = null;

    try {
      const res = await fetch(`${tenantUrl}/v1/tenants/${tenantId}`, {
        headers: {
          "x-internal": "1",
          "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
          "x-tenant-id": tenantId,
        },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json() as { edition?: string; settings?: Record<string, unknown> };
        edition = data.edition ?? "small_office";
        settings = data.settings ?? null;
      }
    } catch {
      // On failure, use defaults (don't block the app from loading)
    }

    const manifest = resolveManifest(edition, settings);
    return reply.send(manifest);
  });
}
