# CivitasOne — Plugin Developer Guide

## Overview

CivitasOne's plugin system allows third-party developers to extend the platform without forking the codebase. Plugins can add new UI pages, listen to domain events, contribute API endpoints, and inject custom business logic into approval workflows.

> **Current Status**: The plugin system is in early development (Tier 3 maturity). This guide describes both the existing infrastructure and the target architecture for the SDK.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  CivitasOne Platform                                  │
│                                                      │
│  ┌─────────┐  ┌─────────┐  ┌──────────────────┐     │
│  │ Finance │  │  HRMS   │  │  Plugin Service  │     │
│  │ Service │  │ Service │  │  (orchestrates)  │     │
│  └────┬────┘  └────┬────┘  └────────┬─────────┘     │
│       │             │               │                │
│       ▼             ▼               ▼                │
│  ┌──────────────────────────────────────────────┐    │
│  │           SQS Event Bus                       │    │
│  │  finance.sanction.approved                    │    │
│  │  hrms.leave.approved                          │    │
│  │  plugins.hook.{pluginId}.{event}              │    │
│  └──────────────────────────────────────────────┘    │
│                      ▲                               │
│                      │                               │
│  ┌───────────────────┴───────────────────────────┐   │
│  │              Plugin Runtime                    │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────────┐   │   │
│  │  │ Plugin A│  │ Plugin B│  │ Plugin C    │   │   │
│  │  │(GST API)│  │(e-Sign) │  │(Custom Rpt) │   │   │
│  │  └─────────┘  └─────────┘  └─────────────┘   │   │
│  └───────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

## Plugin Manifest (Target Schema)

Every plugin is defined by a `plugin.json` manifest:

```json
{
  "id": "gst-return-helper",
  "name": "GST Return Helper",
  "version": "1.0.0",
  "author": "Acme Solutions",
  "description": "Auto-prepares GSTR-1 and GSTR-3B from transaction data",
  "license": "MIT",
  "minPlatformVersion": "0.2.0",
  "permissions": [
    "finance:bills:read",
    "finance:payments:read",
    "procurement:vendors:read",
    "reports:jobs:create"
  ],
  "hooks": {
    "onEvent": [
      { "event": "finance.bill.passed", "handler": "./handlers/on-bill-passed.ts" },
      { "event": "finance.payment.made", "handler": "./handlers/on-payment-made.ts" }
    ],
    "onSchedule": [
      { "cron": "0 2 11 * *", "handler": "./handlers/monthly-return.ts" }
    ]
  },
  "ui": {
    "pages": [
      { "path": "/finance/gst-returns", "component": "./pages/GstReturns.tsx", "nav": { "icon": "📊", "label": "GST Returns", "group": "FINANCE" } }
    ],
    "widgets": [
      { "slot": "finance.dashboard.summary", "component": "./widgets/GstSummaryCard.tsx" }
    ]
  },
  "api": {
    "routes": [
      { "method": "GET", "path": "/v1/plugins/gst/returns", "handler": "./api/list-returns.ts" },
      { "method": "POST", "path": "/v1/plugins/gst/returns/:period/generate", "handler": "./api/generate-return.ts" }
    ]
  },
  "config": {
    "schema": {
      "gstin": { "type": "string", "required": true, "label": "GSTIN Number" },
      "autoFile": { "type": "boolean", "default": false, "label": "Auto-file returns" }
    }
  }
}
```

## Extension Points

### 1. Event Hooks — React to Domain Events

Subscribe to any event published by the 33 CivitasOne services:

```typescript
// handlers/on-bill-passed.ts
import type { PluginEventHandler } from "@civitasone/plugin-sdk";
import type { EventEnvelope } from "@civitasone/events";

export const handler: PluginEventHandler = async (event: EventEnvelope, ctx) => {
  const { tenantId, payload } = event;
  // payload: { billId, vendorId, amount, gstComponents: {...} }

  // Accumulate for monthly GSTR-1
  await ctx.store.upsert("gst_transactions", {
    id: payload.billId,
    period: getCurrentGstPeriod(),
    type: "B2B",
    vendorGstin: payload.vendorGstin,
    taxableValue: payload.amount,
    igst: payload.gstComponents?.igst ?? 0,
    cgst: payload.gstComponents?.cgst ?? 0,
    sgst: payload.gstComponents?.sgst ?? 0,
  });

  ctx.log.info("Accumulated bill for GST return", { billId: payload.billId });
};
```

### 2. UI Pages — Add New Screens

Plugins can contribute full pages to the web app's navigation:

```tsx
// pages/GstReturns.tsx
import { PageHeader, DataTable, Card } from "@civitasone/ui-kit";
import { usePluginApi } from "@civitasone/plugin-sdk/react";

export default function GstReturnsPage() {
  const { data, loading } = usePluginApi<GstReturn[]>("/v1/plugins/gst/returns");

  return (
    <>
      <PageHeader title="GST Returns" subtitle="GSTR-1 and GSTR-3B preparation" />
      <Card title="Returns">
        <DataTable
          columns={[
            { key: "period", label: "Period" },
            { key: "type", label: "Return Type" },
            { key: "status", label: "Status", cellType: "status" },
            { key: "totalTax", label: "Total Tax", cellType: "amount" },
          ]}
          rows={data ?? []}
          sortable
          filterable
          emptyTitle="No returns prepared"
          emptyMessage="Returns will appear here after the monthly auto-generation runs."
        />
      </Card>
    </>
  );
}
```

### 3. Dashboard Widgets — Inject into Existing Screens

```tsx
// widgets/GstSummaryCard.tsx
import { StatCard } from "@civitasone/ui-kit";
import { usePluginApi } from "@civitasone/plugin-sdk/react";

export default function GstSummaryCard() {
  const { data } = usePluginApi<{ pendingReturns: number }>("/v1/plugins/gst/summary");
  return (
    <StatCard
      icon="📊"
      label="Pending GST Returns"
      value={data?.pendingReturns ?? 0}
      iconBg="#fff7ed"
    />
  );
}
```

### 4. API Routes — Custom Backend Logic

```typescript
// api/generate-return.ts
import type { PluginRouteHandler } from "@civitasone/plugin-sdk";

export const handler: PluginRouteHandler = async (req, ctx) => {
  const { period } = req.params;
  const { tenantId } = ctx.auth;

  // Read accumulated transactions for the period
  const transactions = await ctx.store.list("gst_transactions", {
    where: { period, tenantId },
  });

  // Compute GSTR-1 sections (B2B, B2C, CDNR, HSN)
  const gstr1 = computeGstr1(transactions);

  // Store the computed return
  await ctx.store.upsert("gst_returns", {
    id: `${tenantId}-${period}-GSTR1`,
    period,
    type: "GSTR-1",
    status: "draft",
    data: gstr1,
    totalTax: gstr1.totalTax,
    generatedAt: new Date().toISOString(),
  });

  return { status: 201, body: { returnId: `${tenantId}-${period}-GSTR1` } };
};
```

### 5. Scheduled Tasks — Cron-Based Processing

```typescript
// handlers/monthly-return.ts
import type { PluginScheduleHandler } from "@civitasone/plugin-sdk";

export const handler: PluginScheduleHandler = async (ctx) => {
  const period = getPreviousGstPeriod();
  const tenants = await ctx.platform.listTenants({ hasConfig: "gstin" });

  for (const tenant of tenants) {
    await ctx.emit("plugins.gst.generate_requested", {
      tenantId: tenant.id,
      period,
    });
  }
};
```

## Plugin SDK (Target API)

```typescript
// @civitasone/plugin-sdk

export interface PluginContext {
  /** Tenant-scoped key-value store (backed by plugin-service Postgres) */
  store: PluginStore;
  /** Authenticated user/tenant info */
  auth: { tenantId: string; userId: string; roles: string[] };
  /** Structured logger (Pino) */
  log: Logger;
  /** Emit events to the platform event bus */
  emit: (eventType: string, payload: unknown) => Promise<void>;
  /** Call platform APIs (finance, hrms, etc.) with plugin permissions */
  platform: PlatformClient;
  /** Plugin configuration (from tenant admin settings) */
  config: Record<string, unknown>;
}

export interface PluginStore {
  get(collection: string, id: string): Promise<Record<string, unknown> | null>;
  list(collection: string, opts?: { where?: Record<string, unknown>; limit?: number }): Promise<Record<string, unknown>[]>;
  upsert(collection: string, doc: Record<string, unknown> & { id: string }): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
}

export interface PlatformClient {
  listTenants(filter?: { hasConfig?: string }): Promise<Array<{ id: string; name: string }>>;
  finance: { getBills(opts: ListOpts): Promise<Bill[]>; getPayments(opts: ListOpts): Promise<Payment[]> };
  hrms: { getEmployees(opts: ListOpts): Promise<Employee[]> };
  procurement: { getVendors(opts: ListOpts): Promise<Vendor[]> };
}
```

## Plugin Lifecycle

```
   ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
   │  Upload  │────▶│ Install  │────▶│  Enable  │────▶│  Active  │
   │ (store)  │     │(validate)│     │ (config) │     │ (running)│
   └──────────┘     └──────────┘     └──────────┘     └──────────┘
                          │                                   │
                          │                                   ▼
                          │                            ┌──────────┐
                          └───────────────────────────▶│ Disable  │
                                                       │(preserve)│
                                                       └──────────┘
                                                             │
                                                             ▼
                                                       ┌──────────┐
                                                       │Uninstall │
                                                       │ (cleanup)│
                                                       └──────────┘
```

| State | Description |
|-------|-------------|
| Upload | Plugin package uploaded to S3, manifest validated |
| Install | Schema migrations run, permissions checked, dependencies resolved |
| Enable | Tenant admin configures the plugin, event subscriptions activated |
| Active | Hooks fire, UI pages visible, API routes live |
| Disable | Event subscriptions paused, UI hidden, data preserved |
| Uninstall | Data cleaned up, subscriptions removed, package deleted |

## Security & Isolation

| Aspect | Mechanism |
|--------|-----------|
| **Tenant isolation** | Plugin store is tenant-scoped (tenantId in every query). Plugins cannot access other tenants' data. |
| **Permission scoping** | Plugins declare required permissions. Platform enforces access at the API gateway level. |
| **Resource limits** | CPU/memory capped per plugin execution. Store limited to 100MB per tenant per plugin. |
| **Event filtering** | Plugins only receive events they subscribed to in their manifest. |
| **Code sandboxing** | Plugin handlers run in isolated V8 contexts (similar to Cloudflare Workers). |
| **Audit trail** | All plugin API calls are logged as audit events with the plugin's identity. |

## Example Plugin Ideas for CivitasOne

| Plugin | Description | Events Consumed |
|--------|-------------|-----------------|
| GST Return Helper | Auto-prepares GSTR-1/3B from transactions | finance.bill.passed, finance.payment.made |
| PFMS Integration | Posts payments to PFMS and fetches status | finance.payment.made |
| Aadhaar e-KYC | Verifies citizen identity via UIDAI | citizen.request.created |
| DigiLocker Fetch | Pulls certificates from DigiLocker | citizen.document.requested |
| GeM Auto-PO | Creates POs from GeM catalog selections | procurement.indent.approved |
| NPS Calculator | Computes NPS contributions from salary | payroll.run.approved |
| Custom MIS Reports | Generates department-specific PDF reports | Scheduled (monthly) |
| SMS/WhatsApp Channel | Delivers notifications via SMS/WhatsApp | notification.send |
| e-Sign Integration | Adds DSC signing to approvals | workflow.task.approved |
| Biometric Attendance | Syncs AEBAS/biometric device data | Scheduled (hourly) |

## Getting Started (When SDK Ships)

```bash
# 1. Scaffold a new plugin
npx @civitasone/plugin-cli init my-gst-plugin

# 2. Develop locally
cd my-gst-plugin
pnpm dev  # Hot-reload against local CivitasOne stack

# 3. Test
pnpm test  # Runs plugin handler unit tests with mocked context

# 4. Package and upload
pnpm build
pnpm publish --registry https://plugins.civitasone.gov.in

# 5. Install in a tenant (via Admin UI)
# Tenant Admin → Plugins → Search "GST Return Helper" → Install → Configure GSTIN → Enable
```

## Current Limitations (Pre-SDK)

The plugin-service currently only supports:
- A generic "items" CRUD module (placeholder)
- No event subscriptions
- No UI injection
- No scheduled tasks
- No sandboxing

Building the full SDK is tracked as P0 priority in the module gap analysis.
