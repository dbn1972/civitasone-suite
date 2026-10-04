/**
 * platform-integrations — DB access.
 * Reads go through scopedRead()/scopedPlatformRead() so RLS is enforced on the
 * read path; writes take the caller's transaction (the consumer's).
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, scopedRead, scopedPlatformRead } from "../../shared/db.js";
import { adminTenants } from "../tenants/schema.js";
import {
  providers,
  tenantIntegrations,
  productionSwitchRequests,
  tenantIntegrationSettings,
  policyChangeRequests,
  type PolicyRequestRow,
  type ProviderRow,
  type TenantIntegrationRow,
  type TenantIntegrationInsert,
  type SwitchRequestRow,
  type SwitchRequestInsert,
  type TenantIntegrationSettingsRow,
  type EndpointMap,
  type IntegrationCategory,
  type ProviderStatus,
  type IntegrationEnvironment,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete" | "execute">;
type Returning<T> = { returning: (fields?: Record<string, unknown>) => Promise<T[]> };

// ── platform catalogue ───────────────────────────────────────────────────────

export async function listProviders(): Promise<ProviderRow[]> {
  return scopedRead((tx) => tx.select().from(providers).orderBy(asc(providers.category), asc(providers.sortOrder), asc(providers.key)));
}

export async function findProvider(key: string): Promise<ProviderRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(providers).where(eq(providers.key, key)).limit(1));
  return rows[0];
}

export async function findProviderTx(tx: Writer, key: string): Promise<ProviderRow | undefined> {
  const rows = await tx.select().from(providers).where(eq(providers.key, key)).limit(1);
  return rows[0];
}

/** Cross-tenant usage counts per provider/environment (counts only, never tenant data). */
export async function providerUsage(): Promise<Map<string, { sandbox: number; production: number }>> {
  const rows = await scopedPlatformRead((tx) =>
    tx.select({
      providerKey: tenantIntegrations.providerKey,
      environment: tenantIntegrations.environment,
      n: sql<number>`count(*)::int`,
    }).from(tenantIntegrations).groupBy(tenantIntegrations.providerKey, tenantIntegrations.environment),
  );
  const out = new Map<string, { sandbox: number; production: number }>();
  for (const r of rows) {
    const cur = out.get(r.providerKey) ?? { sandbox: 0, production: 0 };
    cur[r.environment] = r.n;
    out.set(r.providerKey, cur);
  }
  return out;
}

/**
 * The catalogue write policy (migration 0039) needs this transaction-local GUC.
 * Server-side only: callers (the catalogue consumer) have already been
 * authorised as super_admin/platform_admin by the route that published the command.
 */
export async function allowCatalogueWrite(tx: Writer): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.platform_catalogue_write', 'true', true)`);
}

export type ProviderPatch = {
  status?: ProviderStatus;
  availabilityMode?: string;
  allowedTenantIds?: string[];
  allowedEditions?: string[];
  endpoints?: EndpointMap;
};

/** Optimistic-locked catalogue update. Returns the new row, or undefined on a stale version. */
export async function updateProviderCond(
  tx: Writer,
  key: string,
  expectedVersion: number,
  patch: ProviderPatch,
  updatedBy: string,
): Promise<ProviderRow | undefined> {
  const rows = await (tx.update(providers)
    .set({ ...patch, updatedAt: new Date(), updatedBy, version: expectedVersion + 1 })
    .where(and(eq(providers.key, key), eq(providers.version, expectedVersion))) as unknown as Returning<ProviderRow>).returning();
  return rows[0];
}

// ── tenant context ───────────────────────────────────────────────────────────

/** The caller tenant's edition, or null when the tenant has no admin_tenants row. */
export async function tenantEdition(tenantId: string): Promise<string | null> {
  const rows = await scopedRead((tx) => tx.select({ edition: adminTenants.edition }).from(adminTenants).where(eq(adminTenants.tenantId, tenantId)).limit(1));
  return rows[0]?.edition ?? null;
}

/** Same as tenantEdition but inside the caller's transaction (consumer re-check). */
export async function tenantEditionTx(tx: Writer, tenantId: string): Promise<string | null> {
  const rows = await tx.select({ edition: adminTenants.edition }).from(adminTenants).where(eq(adminTenants.tenantId, tenantId)).limit(1);
  return rows[0]?.edition ?? null;
}

// ── tenant integrations ──────────────────────────────────────────────────────

export async function listIntegrations(tenantId: string): Promise<TenantIntegrationRow[]> {
  return scopedRead((tx) => tx.select().from(tenantIntegrations)
    .where(eq(tenantIntegrations.tenantId, tenantId))
    .orderBy(asc(tenantIntegrations.category), asc(tenantIntegrations.providerKey)));
}

export async function findIntegration(tenantId: string, providerKey: string): Promise<TenantIntegrationRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.providerKey, providerKey))).limit(1));
  return rows[0];
}

export async function findIntegrationTx(tx: Writer, tenantId: string, providerKey: string): Promise<TenantIntegrationRow | undefined> {
  const rows = await tx.select().from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.providerKey, providerKey))).limit(1);
  return rows[0];
}

/**
 * The tenant's ACTIVE integration for a category: enabled, newest-updated first (deterministic when a
 * tenant has configured more than one provider of the same kind). Used by the peer-service resolver
 * (finance DSC signing); the caller strips secrets before anything leaves this service.
 */
export async function findActiveByCategory(tenantId: string, category: IntegrationCategory): Promise<TenantIntegrationRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.category, category), eq(tenantIntegrations.enabled, true)))
    .orderBy(desc(tenantIntegrations.updatedAt), asc(tenantIntegrations.providerKey)).limit(1));
  return rows[0];
}

/** Insert; returns undefined when (tenant, provider) already exists (lost create race). */
export async function insertIntegration(tx: Writer, row: TenantIntegrationInsert): Promise<TenantIntegrationRow | undefined> {
  const rows = await (tx.insert(tenantIntegrations).values(row).onConflictDoNothing() as unknown as Returning<TenantIntegrationRow>).returning();
  return rows[0];
}

function jsonb(v: unknown) {
  return sql`${JSON.stringify(v)}::jsonb`;
}

function textArray(keys: string[]) {
  if (keys.length === 0) return sql`'{}'::text[]`;
  return sql`ARRAY[${sql.join(keys.map((k) => sql`${k}`), sql`, `)}]::text[]`;
}

/**
 * Save the tenant's form. Conditional on `expectedVersion`; the sealed-secret
 * patch is merged in SQL so a concurrent writer can never lose a secret to a
 * read-modify-write. Config is a full replacement. Resets the health card
 * (the last test no longer describes this config).
 */
export async function saveIntegrationCond(
  tx: Writer,
  tenantId: string,
  providerKey: string,
  expectedVersion: number,
  input: { config: Record<string, unknown>; sealedPatch: Record<string, string>; clearSecrets: string[]; enabled: boolean; revertToSandbox?: boolean },
  actorId: string,
): Promise<TenantIntegrationRow | undefined> {
  const rows = await (tx.update(tenantIntegrations)
    .set({
      config: input.config,
      secrets: sql`(${tenantIntegrations.secrets} || ${jsonb(input.sealedPatch)}) - ${textArray(input.clearSecrets)}`,
      enabled: input.enabled,
      ...(input.revertToSandbox ? { environment: "sandbox" as const } : {}),
      lastTestStatus: null,
      lastTestCode: null,
      lastTestMessage: null,
      lastTestAt: null,
      lastTestEnvironment: null,
      version: expectedVersion + 1,
      updatedAt: new Date(),
      updatedBy: actorId,
    })
    .where(and(
      eq(tenantIntegrations.tenantId, tenantId),
      eq(tenantIntegrations.providerKey, providerKey),
      eq(tenantIntegrations.version, expectedVersion),
    )) as unknown as Returning<TenantIntegrationRow>).returning();
  return rows[0];
}

export async function deleteIntegrationCond(tx: Writer, tenantId: string, providerKey: string, expectedVersion: number): Promise<TenantIntegrationRow | undefined> {
  const rows = await (tx.delete(tenantIntegrations).where(and(
    eq(tenantIntegrations.tenantId, tenantId),
    eq(tenantIntegrations.providerKey, providerKey),
    eq(tenantIntegrations.version, expectedVersion),
  )) as unknown as Returning<TenantIntegrationRow>).returning();
  return rows[0];
}

/** Record the health-card result. Only applies if the environment is unchanged since the test ran. */
export async function recordTestResult(
  tx: Writer,
  tenantId: string,
  providerKey: string,
  result: { environment: IntegrationEnvironment; status: "success" | "failure"; code: string; message: string },
): Promise<boolean> {
  const rows = await (tx.update(tenantIntegrations)
    .set({
      lastTestStatus: result.status,
      lastTestCode: result.code,
      lastTestMessage: result.message,
      lastTestAt: new Date(),
      lastTestEnvironment: result.environment,
      updatedAt: new Date(),
    })
    .where(and(
      eq(tenantIntegrations.tenantId, tenantId),
      eq(tenantIntegrations.providerKey, providerKey),
      eq(tenantIntegrations.environment, result.environment),
    )) as unknown as Returning<{ id: string }>).returning({ id: tenantIntegrations.id });
  return rows.length > 0;
}

/** Flip the environment, guarded by the version AND the expected current environment. */
export async function setEnvironmentCond(
  tx: Writer,
  tenantId: string,
  providerKey: string,
  from: "sandbox" | "production",
  to: "sandbox" | "production",
  expectedVersion: number,
  actorId: string,
): Promise<TenantIntegrationRow | undefined> {
  const rows = await (tx.update(tenantIntegrations)
    .set({
      environment: to,
      lastTestStatus: null,
      lastTestCode: null,
      lastTestMessage: null,
      lastTestAt: null,
      lastTestEnvironment: null,
      version: expectedVersion + 1,
      updatedAt: new Date(),
      updatedBy: actorId,
    })
    .where(and(
      eq(tenantIntegrations.tenantId, tenantId),
      eq(tenantIntegrations.providerKey, providerKey),
      eq(tenantIntegrations.environment, from),
      eq(tenantIntegrations.version, expectedVersion),
    )) as unknown as Returning<TenantIntegrationRow>).returning();
  return rows[0];
}

// ── production-switch requests ───────────────────────────────────────────────

export async function listSwitchRequests(
  tenantId: string,
  opts: { status?: string | undefined; providerKey?: string | undefined; limit: number },
): Promise<SwitchRequestRow[]> {
  return scopedRead((tx) => tx.select().from(productionSwitchRequests)
    .where(and(
      eq(productionSwitchRequests.tenantId, tenantId),
      opts.status ? eq(productionSwitchRequests.status, opts.status) : undefined,
      opts.providerKey ? eq(productionSwitchRequests.providerKey, opts.providerKey) : undefined,
    ))
    .orderBy(desc(productionSwitchRequests.requestedAt), desc(productionSwitchRequests.id))
    .limit(opts.limit));
}

export async function findSwitchRequest(tenantId: string, id: string): Promise<SwitchRequestRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(productionSwitchRequests)
    .where(and(eq(productionSwitchRequests.tenantId, tenantId), eq(productionSwitchRequests.id, id))).limit(1));
  return rows[0];
}

export async function findSwitchRequestTx(tx: Writer, tenantId: string, id: string): Promise<SwitchRequestRow | undefined> {
  const rows = await tx.select().from(productionSwitchRequests)
    .where(and(eq(productionSwitchRequests.tenantId, tenantId), eq(productionSwitchRequests.id, id))).limit(1);
  return rows[0];
}

/** Insert; returns undefined on a duplicate id or an already-pending request for the integration. */
export async function insertSwitchRequest(tx: Writer, row: SwitchRequestInsert): Promise<SwitchRequestRow | undefined> {
  const rows = await (tx.insert(productionSwitchRequests).values(row).onConflictDoNothing() as unknown as Returning<SwitchRequestRow>).returning();
  return rows[0];
}

/**
 * Race-safe decision: the conditional UPDATE is the only thing that decides who
 * wins. `status = 'pending'` makes a double decision a no-op; for approve/reject
 * `requested_by <> actor` enforces maker != checker in the same statement; for
 * cancel `requested_by = actor` restricts it to the requester.
 */
export async function decideSwitchRequestCond(
  tx: Writer,
  tenantId: string,
  id: string,
  decision: "approved" | "rejected" | "cancelled",
  actorId: string,
  note: string | null,
): Promise<SwitchRequestRow | undefined> {
  const actorRule = decision === "cancelled"
    ? eq(productionSwitchRequests.requestedBy, actorId)
    : sql`${productionSwitchRequests.requestedBy} <> ${actorId}`;
  const rows = await (tx.update(productionSwitchRequests)
    .set({ status: decision, decidedBy: actorId, decidedAt: new Date(), decisionNote: note })
    .where(and(
      eq(productionSwitchRequests.tenantId, tenantId),
      eq(productionSwitchRequests.id, id),
      eq(productionSwitchRequests.status, "pending"),
      actorRule,
    )) as unknown as Returning<SwitchRequestRow>).returning();
  return rows[0];
}

/** Downgrade an approval we ourselves just made (same tx, row lock held) when applying it turned out stale. */
export async function voidApprovedRequest(tx: Writer, tenantId: string, id: string, actorId: string, note: string): Promise<void> {
  await tx.update(productionSwitchRequests)
    .set({ status: "rejected", decisionNote: note })
    .where(and(
      eq(productionSwitchRequests.tenantId, tenantId),
      eq(productionSwitchRequests.id, id),
      eq(productionSwitchRequests.status, "approved"),
      eq(productionSwitchRequests.decidedBy, actorId),
    ));
}

// ── policy-change (approval OFF) requests ────────────────────────────────────

export async function listPolicyRequests(tenantId: string, status: string | undefined, limit: number): Promise<PolicyRequestRow[]> {
  return scopedRead((tx) => tx.select().from(policyChangeRequests)
    .where(and(eq(policyChangeRequests.tenantId, tenantId), status ? eq(policyChangeRequests.status, status) : undefined))
    .orderBy(desc(policyChangeRequests.requestedAt), desc(policyChangeRequests.id)).limit(limit));
}

export async function findPolicyRequest(tenantId: string, id: string): Promise<PolicyRequestRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(policyChangeRequests)
    .where(and(eq(policyChangeRequests.tenantId, tenantId), eq(policyChangeRequests.id, id))).limit(1));
  return rows[0];
}

export async function findPolicyRequestTx(tx: Writer, tenantId: string, id: string): Promise<PolicyRequestRow | undefined> {
  const rows = await tx.select().from(policyChangeRequests)
    .where(and(eq(policyChangeRequests.tenantId, tenantId), eq(policyChangeRequests.id, id))).limit(1);
  return rows[0];
}

/** Insert; undefined on a duplicate id or an already-pending request for the tenant. */
export async function insertPolicyRequest(tx: Writer, row: { id: string; tenantId: string; reason: string; requestedBy: string }): Promise<PolicyRequestRow | undefined> {
  const rows = await (tx.insert(policyChangeRequests).values(row).onConflictDoNothing() as unknown as Returning<PolicyRequestRow>).returning();
  return rows[0];
}

/** Race-safe decision: pending only, requested_by <> actor (approve/reject) or = actor (cancel). */
export async function decidePolicyRequestCond(
  tx: Writer, tenantId: string, id: string, decision: "approved" | "rejected" | "cancelled", actorId: string, note: string | null,
): Promise<PolicyRequestRow | undefined> {
  const actorRule = decision === "cancelled"
    ? eq(policyChangeRequests.requestedBy, actorId)
    : sql`${policyChangeRequests.requestedBy} <> ${actorId}`;
  const rows = await (tx.update(policyChangeRequests)
    .set({ status: decision, decidedBy: actorId, decidedAt: new Date(), decisionNote: note })
    .where(and(eq(policyChangeRequests.tenantId, tenantId), eq(policyChangeRequests.id, id), eq(policyChangeRequests.status, "pending"), actorRule)) as unknown as Returning<PolicyRequestRow>).returning();
  return rows[0];
}

export async function voidApprovedPolicyRequest(tx: Writer, tenantId: string, id: string, actorId: string, note: string): Promise<void> {
  await tx.update(policyChangeRequests).set({ status: "rejected", decisionNote: note })
    .where(and(eq(policyChangeRequests.tenantId, tenantId), eq(policyChangeRequests.id, id), eq(policyChangeRequests.status, "approved"), eq(policyChangeRequests.decidedBy, actorId)));
}

// ── per-tenant settings ──────────────────────────────────────────────────────

export async function getSettings(tenantId: string): Promise<TenantIntegrationSettingsRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(tenantIntegrationSettings).where(eq(tenantIntegrationSettings.tenantId, tenantId)).limit(1));
  return rows[0];
}

export async function getSettingsTx(tx: Writer, tenantId: string): Promise<TenantIntegrationSettingsRow | undefined> {
  const rows = await tx.select().from(tenantIntegrationSettings).where(eq(tenantIntegrationSettings.tenantId, tenantId)).limit(1);
  return rows[0];
}

/** Approval is ON unless the tenant has explicitly switched it off. */
export function approvalRequired(row: Pick<TenantIntegrationSettingsRow, "requireProductionApproval"> | undefined): boolean {
  return row?.requireProductionApproval ?? true;
}

/** Upsert the policy row. expectedVersion null => create; otherwise conditional. */
export async function saveSettingsCond(
  tx: Writer,
  tenantId: string,
  requireProductionApproval: boolean,
  expectedVersion: number | null,
  actorId: string,
): Promise<TenantIntegrationSettingsRow | undefined> {
  if (expectedVersion === null) {
    const rows = await (tx.insert(tenantIntegrationSettings)
      .values({ tenantId, requireProductionApproval, updatedBy: actorId })
      .onConflictDoNothing() as unknown as Returning<TenantIntegrationSettingsRow>).returning();
    return rows[0];
  }
  const rows = await (tx.update(tenantIntegrationSettings)
    .set({ requireProductionApproval, version: expectedVersion + 1, updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(tenantIntegrationSettings.tenantId, tenantId), eq(tenantIntegrationSettings.version, expectedVersion))) as unknown as Returning<TenantIntegrationSettingsRow>).returning();
  return rows[0];
}
