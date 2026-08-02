import type { BrandConfigRow } from "./schema.js";

export const BRAND_RESOURCE = "brand";

export const DEFAULTS: Omit<
  BrandConfigRow,
  "tenantId" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy"
> = {
  appName: "CivitasOne",
  tagline: null,
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  loginBgUrl: null,
  footerText: null,
  poweredBy: "Powered by CivitasOne",
  colorPrimary: "#1e40af",
  colorPrimaryFg: "#ffffff",
  colorSecondary: "#64748b",
  colorAccent: "#f59e0b",
  colorBackground: "#ffffff",
  colorSurface: "#f8fafc",
  colorBorder: "#e2e8f0",
  colorText: "#1e293b",
  colorMuted: "#64748b",
  colorSuccess: "#16a34a",
  colorWarning: "#d97706",
  colorError: "#dc2626",
  fontFamily: "Inter, system-ui, sans-serif",
  fontFamilyMono: "JetBrains Mono, monospace",
  sidebarStyle: "default",
  headerStyle: "default",
  borderRadius: "0.5rem",
  customCss: null,
  version: 1,
};
