# 38-web-admin-platform — Build Admin + Platform/Tenant-Admin Screens

## Context

CivitasOne government ERP — Next.js screens for Tenant Admin and Platform admin areas. These screens are used by administrators to manage users, roles, sessions, subscriptions, API keys, notifications, and platform settings.

### Pattern every screen MUST follow

1. Server Component — async function, loader, JSX with Tailwind
2. Loader in `apps/web/src/app/_data/loaders.ts` using `fetchJson`
3. Zod schema in `packages/schemas/src/web.ts`
4. Type in `packages/types/src/index.ts`
5. `PageShell`, `DataSourceBadge` from `@civitasone/ui-kit`
6. Breadcrumb, 4 Stats cards, `<table class="tbl">`, status pills, error badge

### Gateway API prefixes
- admin: `/api/v1/admin`
- identity: `/api/identity`
- policy: `/api/policy`
- billing: `/api/v1/billing`
- notification: `/api/notification`
- install: `/api/v1/install`

## Step 1 — Read existing files

```
apps/web/src/app/(app)/tenant-admin/page.tsx
apps/web/src/app/(app)/tenant-admin/users/page.tsx
apps/web/src/app/(app)/tenant-admin/roles/page.tsx
apps/web/src/app/(app)/tenant-admin/settings/page.tsx
apps/web/src/app/(app)/install/page.tsx
apps/web/src/app/_data/loaders.ts
packages/schemas/src/web.ts
packages/types/src/index.ts
```

Also read HTML prototypes:
- `~/CivitasOne/erpnext-develop/admin-module/web/ta-dashboard.html`
- `~/CivitasOne/erpnext-develop/admin-module/web/ta-users.html`
- `~/CivitasOne/erpnext-develop/admin-module/web/ta-roles.html`
- `~/CivitasOne/erpnext-develop/admin-module/web/ta-audit.html`
- `~/CivitasOne/erpnext-develop/admin-module/web/ta-branding.html`
- `~/CivitasOne/erpnext-develop/admin-module/web/ta-subscription.html`
- `~/CivitasOne/erpnext-develop/platform-module/web/sessions.html`
- `~/CivitasOne/erpnext-develop/platform-module/web/notifications.html`
- `~/CivitasOne/erpnext-develop/platform-module/web/roles.html`
- `~/CivitasOne/erpnext-develop/platform-module/web/security.html`
- `~/CivitasOne/erpnext-develop/platform-module/web/breakglass.html`
- `~/CivitasOne/erpnext-develop/platform-module/web/readiness.html`

## Step 2 — Add Zod schemas to `packages/schemas/src/web.ts`

Append:

```typescript
// Admin / Platform schemas
export const SessionSummarySchema = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string(),
  userName: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  createdAt: z.string(),
  lastActiveAt: z.string(),
  expiresAt: z.string(),
  mfaVerified: z.boolean().default(false),
  status: z.enum(["active", "expired", "revoked"]),
});
export const SessionSummaryListSchema = z.array(SessionSummarySchema);

export const BreakglassSummarySchema = z.object({
  id: z.string(),
  actor: z.string(),
  actorEmail: z.string(),
  reason: z.string(),
  resourceAccessed: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  approvedBy: z.string().optional(),
  status: z.enum(["active", "ended", "auto_expired"]),
});
export const BreakglassSummaryListSchema = z.array(BreakglassSummarySchema);

export const APIKeySummarySchema = z.object({
  id: z.string(),
  keyName: z.string(),
  keyPrefix: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  scopes: z.array(z.string()).default([]),
  status: z.enum(["active", "expired", "revoked"]),
});
export const APIKeySummaryListSchema = z.array(APIKeySummarySchema);

export const InstallStepSummarySchema = z.object({
  id: z.string(),
  stepNo: z.number(),
  title: z.string(),
  description: z.string().optional(),
  isRequired: z.boolean().default(true),
  status: z.enum(["pending", "in_progress", "completed", "failed", "skipped"]),
  completedAt: z.string().optional(),
  errorMessage: z.string().optional(),
});
export const InstallStepSummaryListSchema = z.array(InstallStepSummarySchema);

export const NotificationPrefSummarySchema = z.object({
  id: z.string(),
  eventType: z.string(),
  module: z.string(),
  label: z.string(),
  emailEnabled: z.boolean().default(false),
  smsEnabled: z.boolean().default(false),
  inAppEnabled: z.boolean().default(true),
  webhookEnabled: z.boolean().default(false),
});
export const NotificationPrefSummaryListSchema = z.array(NotificationPrefSummarySchema);

export const UserDetailSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().optional(),
  roles: z.array(z.string()).default([]),
  mfaEnabled: z.boolean().default(false),
  lastLoginAt: z.string().optional(),
  status: z.enum(["active", "inactive", "suspended", "pending_verification"]),
  createdAt: z.string(),
  sessions: z.array(z.object({
    id: z.string(),
    ipAddress: z.string().optional(),
    createdAt: z.string(),
    lastActiveAt: z.string(),
    status: z.string(),
  })).default([]),
});

export const RoleDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  isSystemRole: z.boolean().default(false),
  permissions: z.array(z.object({
    module: z.string(),
    action: z.string(),
    resource: z.string().optional(),
    allowed: z.boolean(),
  })).default([]),
  userCount: z.number().default(0),
  createdAt: z.string(),
});

export const SubscriptionSummarySchema = z.object({
  id: z.string(),
  plan: z.string(),
  status: z.enum(["active", "past_due", "cancelled", "trial"]),
  currentPeriodStart: z.string(),
  currentPeriodEnd: z.string(),
  userLimit: z.number().optional(),
  activeUsers: z.number().default(0),
  moduleAccess: z.array(z.string()).default([]),
  billingEmail: z.string().optional(),
  amount: z.number().optional(),
  currency: z.string().default("INR"),
});

export const TenantModuleSchema = z.object({
  moduleKey: z.string(),
  moduleName: z.string(),
  enabled: z.boolean().default(true),
  enabledAt: z.string().optional(),
});
export const TenantModuleListSchema = z.array(TenantModuleSchema);
```

## Step 3 — Add types to `packages/types/src/index.ts`

Append:

```typescript
export type SessionSummary = {
  id: string;
  userId: string;
  userEmail: string;
  userName?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  mfaVerified: boolean;
  status: "active" | "expired" | "revoked";
};

export type BreakglassSummary = {
  id: string;
  actor: string;
  actorEmail: string;
  reason: string;
  resourceAccessed?: string;
  startedAt: string;
  endedAt?: string;
  approvedBy?: string;
  status: "active" | "ended" | "auto_expired";
};

export type APIKeySummary = {
  id: string;
  keyName: string;
  keyPrefix: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  scopes: string[];
  status: "active" | "expired" | "revoked";
};

export type InstallStepSummary = {
  id: string;
  stepNo: number;
  title: string;
  description?: string;
  isRequired: boolean;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  completedAt?: string;
  errorMessage?: string;
};

export type NotificationPrefSummary = {
  id: string;
  eventType: string;
  module: string;
  label: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  inAppEnabled: boolean;
  webhookEnabled: boolean;
};
```

## Step 4 — Add loaders

Append to `apps/web/src/app/_data/loaders.ts`:

```typescript
export async function getAdminUsers() {
  return fetchJson("/api/identity/users", [] as UserSummary[], {
    revalidateSeconds: 60, telemetryKey: "admin.users", responseSchema: z.array(z.object({
      id: z.string(),
      email: z.string(),
      name: z.string().optional(),
      roles: z.array(z.string()).default([]),
      mfaEnabled: z.boolean().default(false),
      lastLoginAt: z.string().optional(),
      status: z.string(),
      createdAt: z.string(),
    })),
  });
}

export async function getAdminUserById(id: string) {
  return fetchJson(`/api/identity/users/${id}`, null, {
    revalidateSeconds: 30, telemetryKey: "admin.user.detail", responseSchema: UserDetailSchema,
  });
}

export async function getAdminRoles() {
  return fetchJson("/api/policy/roles", [] as RoleDetailSchema[], {
    revalidateSeconds: 120, telemetryKey: "admin.roles", responseSchema: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      isSystemRole: z.boolean().default(false),
      userCount: z.number().default(0),
      createdAt: z.string(),
    })),
  });
}

export async function getAdminRoleById(id: string) {
  return fetchJson(`/api/policy/roles/${id}`, null, {
    revalidateSeconds: 60, telemetryKey: "admin.role.detail", responseSchema: RoleDetailSchema,
  });
}

export async function getTenantModules() {
  return fetchJson("/api/v1/admin/tenant/modules", [] as TenantModuleSchema[], {
    revalidateSeconds: 300, telemetryKey: "admin.modules", responseSchema: TenantModuleListSchema,
  });
}

export async function getActiveSessions() {
  return fetchJson("/api/identity/sessions", [] as SessionSummary[], {
    revalidateSeconds: 30, telemetryKey: "admin.sessions", responseSchema: SessionSummaryListSchema,
  });
}

export async function getSubscription() {
  return fetchJson("/api/v1/billing/subscriptions", null, {
    revalidateSeconds: 300, telemetryKey: "admin.subscription", responseSchema: SubscriptionSummarySchema,
  });
}

export async function getAPIKeys() {
  return fetchJson("/api/v1/admin/api-keys", [] as APIKeySummary[], {
    revalidateSeconds: 60, telemetryKey: "admin.api-keys", responseSchema: APIKeySummaryListSchema,
  });
}

export async function getBreakglassLog() {
  return fetchJson("/api/v1/audit/events", [] as BreakglassSummary[], {
    revalidateSeconds: 30, telemetryKey: "admin.breakglass", responseSchema: BreakglassSummaryListSchema,
  });
}

export async function getNotificationPreferences() {
  return fetchJson("/api/notification/preferences", [] as NotificationPrefSummary[], {
    revalidateSeconds: 120, telemetryKey: "admin.notifications", responseSchema: NotificationPrefSummaryListSchema,
  });
}

export async function getInstallSteps() {
  return fetchJson("/api/v1/install/steps", [] as InstallStepSummary[], {
    revalidateSeconds: 60, telemetryKey: "install.steps", responseSchema: InstallStepSummaryListSchema,
  });
}
```

## Step 5 — Build each page

### 5.1 Wire `/tenant-admin/page.tsx`

Read existing and enhance:
- Wire to `getAdminUsers()` for user count
- Wire to `GET /api/v1/admin/health` (add loader `getAdminHealth()` that calls this endpoint)
- Show system health status (healthy/degraded/down) as a badge
- Show user count as a stat
- Quick links to all admin sub-pages

### 5.2 Enhance `/tenant-admin/users/page.tsx`

Read existing and update:
- Table columns: Name, Email, Roles (comma list), Last Login, MFA Status, Status
- Status pills: active=green, inactive=gray, suspended=red, pending_verification=yellow
- MFA status: enabled=green badge, disabled=gray
- 4 stats: Total Users, Active, Suspended, MFA Enabled count
- Link from each row to `/tenant-admin/users/[id]`

### 5.3 `/tenant-admin/users/[id]/page.tsx`

Create `apps/web/src/app/(app)/tenant-admin/users/[id]/page.tsx`:
- Profile card: Email, Name, Roles, MFA status, Created At
- Sessions table: IP Address, Created At, Last Active, Status with Revoke action (link placeholder)
- API: `getAdminUserById(params.id)`

### 5.4 Enhance `/tenant-admin/roles/page.tsx`

Read existing and update:
- Table columns: Name, Description, System Role (badge), Users Count, Created At
- System Role: show "System" badge in blue
- Link from each row to `/tenant-admin/roles/[id]`

### 5.5 `/tenant-admin/roles/[id]/page.tsx`

Create `apps/web/src/app/(app)/tenant-admin/roles/[id]/page.tsx`:
- Role header: Name, Description, System Role badge, User Count
- Permissions table: Module, Action, Resource, Allowed (green check / red cross)
- API: `getAdminRoleById(params.id)`

### 5.6 Enhance `/tenant-admin/settings/page.tsx`

Read existing and update:
- Module toggles section: list of modules from `getTenantModules()` with enabled/disabled status
- Show each module as a row: Module Name, Enabled (green "Active" / gray "Disabled"), Enabled At
- Note: toggle UI is display-only (read-only list) — actual toggle would require a PATCH endpoint

### 5.7 `/tenant-admin/audit/page.tsx`

Create `apps/web/src/app/(app)/tenant-admin/audit/page.tsx`:
- Table: same as main audit event log
- Filter to tenant-scoped events
- API: `GET /api/v1/audit/events?tenantScoped=true`
- Add loader `getTenantAuditLog()`:
  ```typescript
  export async function getTenantAuditLog() {
    return fetchJson("/api/v1/audit/events", [] as AuditEventSchema[], {
      revalidateSeconds: 30, telemetryKey: "admin.audit", responseSchema: z.array(z.object({
        id: z.string(),
        actor: z.string(),
        action: z.string(),
        resource: z.string().optional(),
        outcome: z.string(),
        timestamp: z.string(),
        ipAddress: z.string().optional(),
      })),
    });
  }
  ```
- Table: Actor, Action, Resource, Outcome, Timestamp, IP Address

### 5.8 `/tenant-admin/sessions/page.tsx`

Create `apps/web/src/app/(app)/tenant-admin/sessions/page.tsx`:
- Table: User Email, User Name, IP Address, Created At, Last Active, Expires At, MFA Verified, Status
- Status pills: active=green, expired=gray, revoked=red
- 4 stats: Total Sessions, Active, Expired, MFA Verified count
- API: `getActiveSessions()`

### 5.9 `/tenant-admin/subscription/page.tsx`

Create `apps/web/src/app/(app)/tenant-admin/subscription/page.tsx`:
- Plan card: Plan name, Status, Current period (from → to), User limit, Active users, Amount (₹)
- Status pills: active=green, past_due=red, cancelled=gray, trial=yellow
- Module access section: list of accessible modules
- Billing email
- API: `getSubscription()`

### 5.10 `/tenant-admin/api-keys/page.tsx`

Create `apps/web/src/app/(app)/tenant-admin/api-keys/page.tsx`:
- Table: Key Name, Key Prefix (mask rest), Created By, Created At, Last Used, Expires At, Scopes, Status
- Status pills: active=green, expired=gray, revoked=red
- Key prefix: show as `sk_live_****` format (prefix + asterisks)
- Scopes: show as small comma-separated tags
- 4 stats: Total, Active, Expired, Never Used (no lastUsedAt)
- New API Key button (placeholder)

### 5.11 `/tenant-admin/breakglass/page.tsx`

Create `apps/web/src/app/(app)/tenant-admin/breakglass/page.tsx`:
- Title: "Break-Glass Access Log"
- Table: Actor, Actor Email, Reason, Resource Accessed, Started At, Ended At, Approved By, Status
- Status pills: active=red (highlight this is ongoing!), ended=gray, auto_expired=yellow
- 4 stats: Total Events, Active Now, Ended, This Month
- API: `getBreakglassLog()`

### 5.12 `/tenant-admin/notifications/page.tsx`

Create `apps/web/src/app/(app)/tenant-admin/notifications/page.tsx`:
- Title: "Notification Preferences"
- Table: Event Type, Module, Label, Email (yes/no badge), SMS (yes/no badge), In-App (yes/no badge), Webhook (yes/no badge)
- yes=green badge, no=gray badge
- Filter by module (group by module)
- API: `getNotificationPreferences()`

### 5.13 Wire `/install/page.tsx`

Read existing and update:
- Wire to `getInstallSteps()` for step list
- Show overall progress bar: `completedSteps / totalSteps * 100` (CSS width % on a div)
- Steps list: numbered cards showing Step No, Title, Description, Status, Completed At, Error Message
- Status icons: pending=gray circle, in_progress=yellow spinner emoji, completed=green check, failed=red cross, skipped=gray dash
- Overall status banner: if all required steps complete → "Installation Complete", else → "Setup In Progress"
- API: `getInstallSteps()`

## Step 6 — Update `/tenant-admin/page.tsx`

Ensure the hub page links to ALL sub-pages:
- Users, Roles, Settings, Audit Log, Sessions, Subscription, API Keys, Break-Glass

## Step 7 — Verification

```bash
cd ~/CivitasOne/civitasone-suite
pnpm --filter @civitasone/schemas typecheck
pnpm --filter @civitasone/web typecheck
```

Fix errors. Note: if `UserSummary` type is not yet defined in `packages/types/src/index.ts`, add it:
```typescript
export type UserSummary = {
  id: string;
  email: string;
  name?: string;
  roles: string[];
  mfaEnabled: boolean;
  lastLoginAt?: string;
  status: string;
  createdAt: string;
};
```
