/**
 * COMP-020 contract: the web loaders + screens against the REAL response shape of
 * admin-service GET /v1/admin/{editions,entitlements,gateways}. The payloads below
 * are trimmed copies of the service's actual output (services/admin-service/tests/
 * platform-catalogue.test.ts asserts the same keys), including the null figures the
 * platform does not track.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./apiClient", () => ({
  fetchJson: async (_path: string, empty: unknown, opts: { mapResponse?: (p: unknown) => unknown }) => {
    const payload = (globalThis as { __payload?: unknown }).__payload;
    const data = opts.mapResponse ? opts.mapResponse(payload) : payload;
    return { data: data ?? empty, source: "api" };
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const seeded = vi.fn();
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: (...a: unknown[]) => seeded(...a) }));

import { getSAEditions, getSAEntitlements, getSAGateways } from "./loaders";
import { EditionsTable } from "@/app/(app)/admin/editions/EditionsTable";
import { EntitlementsTable } from "@/app/(app)/admin/entitlements/EntitlementsTable";
import { GatewaysTable } from "@/app/(app)/admin/gateways/GatewaysTable";

const EDITIONS = { data: [
  { code: "govt_dept", name: "Government", subtitle: "Dept / Municipal / PSE", modulesIncluded: 28, modules: ["employee", "attendance"], pricing: null, tenants: 7, status: "active" },
  { code: "smarttransfer_standalone", name: "SmartTransfer OS (standalone)", subtitle: "Workforce movement engine, no full HRMS", modulesIncluded: 1, modules: ["smarttransfer"], pricing: null, tenants: 0, status: "active" },
], total: 2, generatedAt: "2026-10-24T10:00:00.000Z" };
const ENTITLEMENTS = { data: [
  { module: "Employee Master (HRIS)", moduleId: "employee", edition: "govt_dept", tenant: "", tenantId: null, limit: "", used: "", status: "active" },
  { module: "SmartTransfer", moduleId: "smarttransfer", edition: "govt_dept", tenant: "Comp020 Dept A", tenantId: "cafe0020-0000-4000-8000-00000000000a", limit: "", used: "", status: "active" },
], total: 2, truncated: false, generatedAt: "2026-10-24T10:00:00.000Z" };
const GATEWAYS = { data: [
  { type: "SMS", provider: "Twilio SMS", providerKey: "sms_twilio", messagesPerDay: null, successRate: null, lastChecked: "2026-10-24T09:30:00.000Z", status: "degraded", tenantsEnabled: 2, tenantsConnected: 1, tenantsFailed: 1 },
  { type: "WhatsApp", provider: "WhatsApp (Meta)", providerKey: "whatsapp_meta", messagesPerDay: null, successRate: null, lastChecked: null, status: "standby", tenantsEnabled: 0, tenantsConnected: 0, tenantsFailed: 0 },
  { type: "Email", provider: "SMTP Email", providerKey: "email_smtp", messagesPerDay: null, successRate: null, lastChecked: "2026-10-24T09:30:00.000Z", status: "active", tenantsEnabled: 1, tenantsConnected: 1, tenantsFailed: 0 },
  { type: "Push", provider: "Firebase Cloud Messaging", providerKey: "push_fcm", messagesPerDay: null, successRate: null, lastChecked: null, status: "down", tenantsEnabled: 1, tenantsConnected: 0, tenantsFailed: 1 },
], total: 4, generatedAt: "2026-10-24T10:00:00.000Z" };

const stat = (l: string) => (screen.getAllByText(l).find((e) => e.classList.contains("lab")) as HTMLElement).parentElement as HTMLElement;

describe("COMP-020 loaders parse the real admin-service envelope", () => {
  beforeEach(() => seeded.mockReset());

  it("getSAEditions keeps every row with null pricing and a normalised status", async () => {
    (globalThis as { __payload?: unknown }).__payload = EDITIONS;
    const { data } = await getSAEditions();
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ name: "Government", modulesIncluded: 28, pricing: null, tenants: 7, status: "active" });
  });

  it("EditionsTable shows the real rows: totals, tenants, active", async () => {
    (globalThis as { __payload?: unknown }).__payload = EDITIONS;
    const { data } = await getSAEditions();
    seeded.mockReturnValue({ data, provenance: "live", offline: false, cachedAt: null });
    render(<EditionsTable editions={data} />);
    expect(stat("Total Editions")).toHaveTextContent("2");
    expect(stat("Active")).toHaveTextContent("2");
    expect(stat("Total Tenants")).toHaveTextContent("7");
    expect(screen.getByText("Government")).toBeInTheDocument();
  });

  it("EntitlementsTable shows edition defaults and a tenant override, untracked usage as an em dash", async () => {
    (globalThis as { __payload?: unknown }).__payload = ENTITLEMENTS;
    const { data } = await getSAEntitlements();
    expect(data).toHaveLength(2);
    seeded.mockReturnValue({ data, provenance: "live", offline: false, cachedAt: null });
    render(<EntitlementsTable entitlements={data} />);
    expect(stat("Total Entitlements")).toHaveTextContent("2");
    expect(stat("Active")).toHaveTextContent("2");
    expect(stat("Editions")).toHaveTextContent("1");
    expect(stat("At / over limit")).toHaveTextContent("0");
    expect(screen.getByText("Comp020 Dept A")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("GatewaysTable counts degraded / standby / down from the real statuses and never invents a success rate", async () => {
    (globalThis as { __payload?: unknown }).__payload = GATEWAYS;
    const { data } = await getSAGateways();
    expect(data).toHaveLength(4);
    seeded.mockReturnValue({ data, provenance: "live", offline: false, cachedAt: null });
    render(<GatewaysTable gateways={data} />);
    expect(stat("Total Gateways")).toHaveTextContent("4");
    expect(stat("Active")).toHaveTextContent("1");
    expect(stat("Degraded")).toHaveTextContent("1");
    expect(stat("Standby")).toHaveTextContent("1");
    expect(stat("Down / failed")).toHaveTextContent("1");
    expect(screen.getByText("Twilio SMS")).toBeInTheDocument();
  });
});
