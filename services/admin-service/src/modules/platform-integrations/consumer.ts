/**
 * platform-integrations — command consumers.
 *
 * EVERY write happens here, in one transaction with an `audit.event.record`
 * outbox event. Register with tenantScoped(queue) so the tenant GUC is set from
 * the message's tenant (the tenant tables are FORCE RLS).
 *
 * Rules enforced here, not only in the route (the route's pre-checks are a
 * fast-fail; the consumer is the authority):
 *   - every mutation is a conditional UPDATE (version / status / environment /
 *     requester predicates) so a race has exactly one winner;
 *   - maker != checker for a production switch is part of the decision UPDATE
 *     itself (`requested_by <> actor`) and again a DB CHECK constraint;
 *   - the production switch re-validates provider eligibility and field
 *     completeness at decision time;
 *   - a business-rule refusal is recorded as an audit event with
 *     outcome "failure" and a reason code; the command is then consumed (a
 *     deterministic refusal must not retry forever).
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  providerUpdateCommand,
  recordSaveCommand,
  recordDeleteCommand,
  recordTestCommand,
  switchRequestCommand,
  switchDecideCommand,
  revertSandboxCommand,
  settingsUpdateCommand,
  policyRequestCommand,
  policyDecideCommand,
} from "./commands.js";
import { assertProductionEligible, IntegrationError, isAvailableToTenant, missingRequired, parseFields, touchesSensitive } from "./domain.js";
import { POLICY_ROLES, canUseCategory } from "./roles.js";
import type { IntegrationCategory, ProviderRow, TenantIntegrationRow } from "./schema.js";

const log = pino({ name: "admin-platform-integrations-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "platform_integration";

interface Msg {
  messageId: string;
  tenantId: string;
  actorId: string;
  correlationId: string;
  payload: unknown;
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Ctx = { tenantId: string; actorId: string; correlationId: string };

function ctxOf(m: Msg): Ctx {
  return { tenantId: m.tenantId, actorId: m.actorId, correlationId: m.correlationId };
}

async function audit(
  tx: Tx,
  ctx: Ctx,
  action: string,
  resourceId: string,
  outcome: "success" | "failure",
  extra: Record<string, unknown> = {},
): Promise<void> {
  await enqueue(tx as never, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: { service: "admin", action, resourceType: RESOURCE, resourceId, outcome, ...extra },
  });
}

/** Run a handler in one tx, claiming the message id first (redelivery of the same message is a no-op). */
async function inTx(m: Msg, fn: (tx: Tx, w: repo.Writer) => Promise<void>): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx as never, m.messageId))) return;
    await fn(tx, tx as unknown as repo.Writer);
  });
}

function secretKeys(row: Pick<TenantIntegrationRow, "secrets">): string[] {
  return Object.keys(row.secrets ?? {});
}

/** The tenant must still be allowed to use the provider (allow-list / edition / not disabled), re-checked in the tx. */
async function availabilityBlocker(w: repo.Writer, tenantId: string, provider: ProviderRow): Promise<string | null> {
  if (provider.status === "disabled") return "PROVIDER_DISABLED";
  const edition = await repo.tenantEditionTx(w, tenantId);
  return isAvailableToTenant(provider, tenantId, edition) ? null : "PROVIDER_NOT_AVAILABLE";
}

const roleOk = (category: IntegrationCategory, roles: string[]) => canUseCategory(category, roles);

/** Reasons a row cannot go to production. Empty => eligible. */
function productionBlockers(provider: ProviderRow, row: TenantIntegrationRow): string | null {
  try {
    assertProductionEligible(provider.status);
  } catch (e) {
    if (e instanceof IntegrationError) return e.code;
    throw e;
  }
  const missing = missingRequired(parseFields(provider.configSchema), "production", row.config ?? {}, secretKeys(row));
  return missing.length > 0 ? "CONFIG_INCOMPLETE" : null;
}

// ── platform catalogue ───────────────────────────────────────────────────────

export async function handleProviderUpdate(m: Msg): Promise<void> {
  const cmd = providerUpdateCommand.parse(m.payload);
  const ctx = ctxOf(m);
  await inTx(m, async (tx, w) => {
    await repo.allowCatalogueWrite(w);
    const before = await repo.findProviderTx(w, cmd.key);
    if (!before) { await audit(tx, ctx, "platform_integration.provider_update", cmd.key, "failure", { reason: "NOT_FOUND" }); return; }
    const p = cmd.patch;
    const patch: repo.ProviderPatch = {};
    if (p.status) patch.status = p.status;
    if (p.availability) {
      patch.availabilityMode = p.availability.mode;
      patch.allowedTenantIds = p.availability.mode === "restricted" ? p.availability.tenantIds : [];
      patch.allowedEditions = p.availability.mode === "restricted" ? p.availability.editions : [];
    }
    if (p.endpoints) patch.endpoints = p.endpoints;
    const after = await repo.updateProviderCond(w, cmd.key, cmd.expectedVersion, patch, ctx.actorId);
    if (!after) { await audit(tx, ctx, "platform_integration.provider_update", cmd.key, "failure", { reason: "VERSION_CONFLICT", expectedVersion: cmd.expectedVersion }); return; }
    await audit(tx, ctx, "platform_integration.provider_update", cmd.key, "success", {
      statusBefore: before.status, statusAfter: after.status,
      availabilityBefore: before.availabilityMode, availabilityAfter: after.availabilityMode,
      tenantsAfter: after.allowedTenantIds.length, editionsAfter: after.allowedEditions,
      endpointsChanged: Boolean(p.endpoints),
    });
  });
}

// ── tenant record ────────────────────────────────────────────────────────────

export async function handleRecordSave(m: Msg): Promise<void> {
  const cmd = recordSaveCommand.parse(m.payload);
  const ctx = ctxOf(m);
  await inTx(m, async (tx, w) => {
    const provider = await repo.findProviderTx(w, cmd.providerKey);
    const blocker = provider ? await availabilityBlocker(w, ctx.tenantId, provider) : "NOT_FOUND";
    if (!provider || blocker) {
      await audit(tx, ctx, "tenant_integration.save", cmd.providerKey, "failure", { reason: blocker });
      return;
    }
    if (!roleOk(provider.category, cmd.actorRoles)) {
      await audit(tx, ctx, "tenant_integration.save", cmd.providerKey, "failure", { reason: "ROLE_NOT_ALLOWED" });
      return;
    }
    // A live production record never stays live after a sensitive edit (endpoint / account /
    // credential): it reverts to sandbox in the SAME UPDATE, so the switch maker-checker applies again.
    const existing = cmd.expectedVersion === null ? undefined : await repo.findIntegrationTx(w, ctx.tenantId, cmd.providerKey);
    const revert = existing?.environment === "production"
      && touchesSensitive(parseFields(provider.configSchema), existing.config ?? {}, cmd.config, Object.keys(cmd.sealedPatch), cmd.clearSecrets);
    let saved: TenantIntegrationRow | undefined;
    if (cmd.expectedVersion === null) {
      saved = await repo.insertIntegration(w, {
        id: cmd.newId,
        tenantId: ctx.tenantId,
        providerKey: cmd.providerKey,
        category: cmd.category,
        environment: "sandbox",
        enabled: cmd.enabled,
        config: cmd.config,
        secrets: cmd.sealedPatch,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
    } else {
      saved = await repo.saveIntegrationCond(w, ctx.tenantId, cmd.providerKey, cmd.expectedVersion, {
        config: cmd.config, sealedPatch: cmd.sealedPatch, clearSecrets: cmd.clearSecrets, enabled: cmd.enabled, revertToSandbox: revert,
      }, ctx.actorId);
    }
    const action = cmd.expectedVersion === null ? "tenant_integration.create" : revert ? "tenant_integration.reverted_to_sandbox_on_edit" : "tenant_integration.update";
    if (!saved) { await audit(tx, ctx, action, cmd.providerKey, "failure", { reason: "VERSION_CONFLICT" }); return; }
    // Field NAMES only: never a secret and not even a config value.
    await audit(tx, ctx, action, saved.id, "success", {
      providerKey: cmd.providerKey, environment: saved.environment, enabled: saved.enabled,
      configFields: Object.keys(cmd.config), secretFieldsWritten: Object.keys(cmd.sealedPatch), secretFieldsCleared: cmd.clearSecrets,
      version: saved.version,
    });
  });
}

export async function handleRecordDelete(m: Msg): Promise<void> {
  const cmd = recordDeleteCommand.parse(m.payload);
  const ctx = ctxOf(m);
  await inTx(m, async (tx, w) => {
    const current = await repo.findIntegrationTx(w, ctx.tenantId, cmd.providerKey);
    if (current && !roleOk(current.category, cmd.actorRoles)) { await audit(tx, ctx, "tenant_integration.delete", cmd.providerKey, "failure", { reason: "ROLE_NOT_ALLOWED" }); return; }
    const removed = await repo.deleteIntegrationCond(w, ctx.tenantId, cmd.providerKey, cmd.expectedVersion);
    if (!removed) { await audit(tx, ctx, "tenant_integration.delete", cmd.providerKey, "failure", { reason: "VERSION_CONFLICT_OR_NOT_FOUND" }); return; }
    await audit(tx, ctx, "tenant_integration.delete", removed.id, "success", { providerKey: cmd.providerKey, environment: removed.environment });
  });
}

export async function handleRecordTest(m: Msg): Promise<void> {
  const cmd = recordTestCommand.parse(m.payload);
  const ctx = ctxOf(m);
  await inTx(m, async (tx, w) => {
    const current = await repo.findIntegrationTx(w, ctx.tenantId, cmd.providerKey);
    if (current && !roleOk(current.category, cmd.actorRoles)) { await audit(tx, ctx, "tenant_integration.test", cmd.providerKey, "failure", { reason: "ROLE_NOT_ALLOWED" }); return; }
    const applied = await repo.recordTestResult(w, ctx.tenantId, cmd.providerKey, cmd);
    await audit(tx, ctx, "tenant_integration.test", cmd.providerKey, applied ? "success" : "failure", {
      environment: cmd.environment, testStatus: cmd.status, testCode: cmd.code, ...(applied ? {} : { reason: "ENVIRONMENT_CHANGED" }),
    });
  });
}

// ── production switch ────────────────────────────────────────────────────────

export async function handleSwitchRequest(m: Msg): Promise<void> {
  const cmd = switchRequestCommand.parse(m.payload);
  const ctx = ctxOf(m);
  const action = "production_switch.request";
  await inTx(m, async (tx, w) => {
    const [row, provider, settings] = await Promise.all([
      repo.findIntegrationTx(w, ctx.tenantId, cmd.providerKey),
      repo.findProviderTx(w, cmd.providerKey),
      repo.getSettingsTx(w, ctx.tenantId),
    ]);
    const refuse = (reason: string) => audit(tx, ctx, action, cmd.providerKey, "failure", { reason });
    if (!row || !provider) return refuse("NOT_FOUND");
    if (!roleOk(provider.category, cmd.actorRoles)) return refuse("ROLE_NOT_ALLOWED");
    const unavailable = await availabilityBlocker(w, ctx.tenantId, provider);
    if (unavailable) return refuse(unavailable);
    if (row.environment !== "sandbox") return refuse("ALREADY_PRODUCTION");
    if (row.version !== cmd.baseVersion) return refuse("VERSION_CONFLICT");
    const blocker = productionBlockers(provider, row);
    if (blocker) return refuse(blocker);

    if (repo.approvalRequired(settings)) {
      const created = await repo.insertSwitchRequest(w, {
        id: cmd.requestId, tenantId: ctx.tenantId, integrationId: row.id, providerKey: cmd.providerKey,
        status: "pending", reason: cmd.reason, baseVersion: row.version, requestedBy: ctx.actorId,
      });
      if (!created) return refuse("ALREADY_PENDING");
      await audit(tx, ctx, action, created.id, "success", { providerKey: cmd.providerKey, mode: "pending" });
      return;
    }

    // Approval switched OFF for this tenant: apply directly, still fully audited.
    const flipped = await repo.setEnvironmentCond(w, ctx.tenantId, cmd.providerKey, "sandbox", "production", row.version, ctx.actorId);
    if (!flipped) return refuse("VERSION_CONFLICT");
    const created = await repo.insertSwitchRequest(w, {
      id: cmd.requestId, tenantId: ctx.tenantId, integrationId: row.id, providerKey: cmd.providerKey,
      status: "approved", reason: cmd.reason, baseVersion: row.version, requestedBy: ctx.actorId,
      decidedBy: ctx.actorId, decidedAt: new Date(), decisionNote: "Applied directly: approval is switched off for this tenant", direct: true,
    });
    await audit(tx, ctx, "production_switch.applied_direct", created?.id ?? cmd.requestId, "success", { providerKey: cmd.providerKey });
  });
}

export async function handleSwitchDecide(m: Msg): Promise<void> {
  const cmd = switchDecideCommand.parse(m.payload);
  const ctx = ctxOf(m);
  const action = `production_switch.${cmd.decision}`;
  await inTx(m, async (tx, w) => {
    const req = await repo.findSwitchRequestTx(w, ctx.tenantId, cmd.requestId);
    const refuse = (reason: string) => audit(tx, ctx, action, cmd.requestId, "failure", { reason });
    if (!req) return refuse("NOT_FOUND");
    const reqProvider = await repo.findProviderTx(w, req.providerKey);
    if (!reqProvider) return refuse("NOT_FOUND");
    if (!roleOk(reqProvider.category, cmd.actorRoles)) return refuse("ROLE_NOT_ALLOWED");

    if (cmd.decision !== "approve") {
      const decided = await repo.decideSwitchRequestCond(w, ctx.tenantId, cmd.requestId, cmd.decision === "reject" ? "rejected" : "cancelled", ctx.actorId, cmd.note);
      if (!decided) return refuse("NOT_PENDING_OR_NOT_ALLOWED");
      await audit(tx, ctx, action, decided.id, "success", { providerKey: decided.providerKey });
      return;
    }

    const [row, provider] = await Promise.all([
      repo.findIntegrationTx(w, ctx.tenantId, req.providerKey),
      repo.findProviderTx(w, req.providerKey),
    ]);
    if (!row || !provider) return refuse("NOT_FOUND");
    const unavailable = await availabilityBlocker(w, ctx.tenantId, provider);
    if (unavailable) return refuse(unavailable);
    const blocker = productionBlockers(provider, row);
    if (blocker) return refuse(blocker);

    // 1) Win the pending -> approved transition. requested_by <> actor lives in the UPDATE.
    const approved = await repo.decideSwitchRequestCond(w, ctx.tenantId, cmd.requestId, "approved", ctx.actorId, cmd.note);
    if (!approved) return refuse("NOT_PENDING_OR_NOT_ALLOWED");

    // 2) Flip the environment, guarded by the version the request was raised against.
    const flipped = await repo.setEnvironmentCond(w, ctx.tenantId, req.providerKey, "sandbox", "production", req.baseVersion, ctx.actorId);
    if (!flipped) {
      // The configuration changed after the request: this approval is void. We hold the
      // row lock from step 1, so downgrading the decision here cannot race.
      await repo.voidApprovedRequest(w, ctx.tenantId, cmd.requestId, ctx.actorId, "Auto-rejected: the configuration changed after the request was raised");
      return refuse("STALE_CONFIGURATION");
    }
    await audit(tx, ctx, action, approved.id, "success", { providerKey: approved.providerKey, requestedBy: approved.requestedBy });
  });
}

export async function handleRevertSandbox(m: Msg): Promise<void> {
  const cmd = revertSandboxCommand.parse(m.payload);
  const ctx = ctxOf(m);
  await inTx(m, async (tx, w) => {
    const current = await repo.findIntegrationTx(w, ctx.tenantId, cmd.providerKey);
    if (current && !roleOk(current.category, cmd.actorRoles)) { await audit(tx, ctx, "tenant_integration.revert_sandbox", cmd.providerKey, "failure", { reason: "ROLE_NOT_ALLOWED" }); return; }
    const flipped = await repo.setEnvironmentCond(w, ctx.tenantId, cmd.providerKey, "production", "sandbox", cmd.expectedVersion, ctx.actorId);
    if (!flipped) { await audit(tx, ctx, "tenant_integration.revert_sandbox", cmd.providerKey, "failure", { reason: "VERSION_CONFLICT_OR_NOT_PRODUCTION" }); return; }
    await audit(tx, ctx, "tenant_integration.revert_sandbox", flipped.id, "success", { providerKey: cmd.providerKey, reason: cmd.reason });
  });
}

// ── per-tenant policy ────────────────────────────────────────────────────────

export async function handleSettingsUpdate(m: Msg): Promise<void> {
  const cmd = settingsUpdateCommand.parse(m.payload);
  const ctx = ctxOf(m);
  await inTx(m, async (tx, w) => {
    if (!cmd.actorRoles.some((r) => POLICY_ROLES.includes(r))) { await audit(tx, ctx, "tenant_integration.settings_update", ctx.tenantId, "failure", { reason: "ROLE_NOT_ALLOWED" }); return; }
    // Turning approval OFF is never a single-actor change: it goes through a policy-change request.
    if (!cmd.requireProductionApproval) { await audit(tx, ctx, "tenant_integration.settings_update", ctx.tenantId, "failure", { reason: "POLICY_OFF_REQUIRES_APPROVAL" }); return; }
    const before = await repo.getSettingsTx(w, ctx.tenantId);
    const saved = await repo.saveSettingsCond(w, ctx.tenantId, cmd.requireProductionApproval, cmd.expectedVersion, ctx.actorId);
    if (!saved) { await audit(tx, ctx, "tenant_integration.settings_update", ctx.tenantId, "failure", { reason: "VERSION_CONFLICT" }); return; }
    await audit(tx, ctx, "tenant_integration.settings_update", ctx.tenantId, "success", {
      requireProductionApprovalBefore: repo.approvalRequired(before), requireProductionApprovalAfter: saved.requireProductionApproval,
    });
  });
}

export async function handlePolicyRequest(m: Msg): Promise<void> {
  const cmd = policyRequestCommand.parse(m.payload);
  const ctx = ctxOf(m);
  const action = "policy_change.request";
  await inTx(m, async (tx, w) => {
    const refuse = (reason: string) => audit(tx, ctx, action, cmd.requestId, "failure", { reason });
    if (!cmd.actorRoles.some((r) => POLICY_ROLES.includes(r))) return refuse("ROLE_NOT_ALLOWED");
    if (!repo.approvalRequired(await repo.getSettingsTx(w, ctx.tenantId))) return refuse("ALREADY_OFF");
    const created = await repo.insertPolicyRequest(w, { id: cmd.requestId, tenantId: ctx.tenantId, reason: cmd.reason, requestedBy: ctx.actorId });
    if (!created) return refuse("ALREADY_PENDING");
    await audit(tx, ctx, action, created.id, "success", { change: "require_production_approval:false" });
  });
}

export async function handlePolicyDecide(m: Msg): Promise<void> {
  const cmd = policyDecideCommand.parse(m.payload);
  const ctx = ctxOf(m);
  const action = `policy_change.${cmd.decision}`;
  await inTx(m, async (tx, w) => {
    const refuse = (reason: string) => audit(tx, ctx, action, cmd.requestId, "failure", { reason });
    // Deciding a policy-OFF request is a tenant-level decision: POLICY_ROLES only (empty roles fail closed).
    if (!cmd.actorRoles.some((r) => POLICY_ROLES.includes(r))) return refuse("ROLE_NOT_ALLOWED");
    if (!(await repo.findPolicyRequestTx(w, ctx.tenantId, cmd.requestId))) return refuse("NOT_FOUND");

    if (cmd.decision !== "approve") {
      const decided = await repo.decidePolicyRequestCond(w, ctx.tenantId, cmd.requestId, cmd.decision === "reject" ? "rejected" : "cancelled", ctx.actorId, cmd.note);
      if (!decided) return refuse("NOT_PENDING_OR_NOT_ALLOWED");
      await audit(tx, ctx, action, decided.id, "success", {});
      return;
    }
    // 1) Win pending -> approved (requested_by <> actor is part of the UPDATE, plus a CHECK).
    const approved = await repo.decidePolicyRequestCond(w, ctx.tenantId, cmd.requestId, "approved", ctx.actorId, cmd.note);
    if (!approved) return refuse("NOT_PENDING_OR_NOT_ALLOWED");
    // 2) Only now flip the setting (version-guarded).
    const current = await repo.getSettingsTx(w, ctx.tenantId);
    const flipped = await repo.saveSettingsCond(w, ctx.tenantId, false, current ? current.version : null, ctx.actorId);
    if (!flipped) {
      await repo.voidApprovedPolicyRequest(w, ctx.tenantId, cmd.requestId, ctx.actorId, "Auto-rejected: the setting changed while the request was open");
      return refuse("VERSION_CONFLICT");
    }
    await audit(tx, ctx, action, approved.id, "success", { requestedBy: approved.requestedBy, requireProductionApprovalAfter: false });
  });
}

export function registerPlatformIntegrationConsumers(queue: Queue): void {
  const sub = (topic: string, fn: (m: Msg) => Promise<void>) =>
    queue.subscribe(topic, async (msg) => {
      try {
        await fn(msg as unknown as Msg);
      } catch (err) {
        log.error({ err, topic, messageId: (msg as unknown as Msg).messageId }, "platform-integration command failed");
        throw err;
      }
    });
  sub(COMMANDS.platformIntegrationProviderUpdate, handleProviderUpdate);
  sub(COMMANDS.tenantIntegrationSave, handleRecordSave);
  sub(COMMANDS.tenantIntegrationDelete, handleRecordDelete);
  sub(COMMANDS.tenantIntegrationRecordTest, handleRecordTest);
  sub(COMMANDS.tenantIntegrationSwitchRequest, handleSwitchRequest);
  sub(COMMANDS.tenantIntegrationSwitchDecide, handleSwitchDecide);
  sub(COMMANDS.tenantIntegrationRevertSandbox, handleRevertSandbox);
  sub(COMMANDS.tenantIntegrationSettingsUpdate, handleSettingsUpdate);
  sub(COMMANDS.tenantIntegrationPolicyRequest, handlePolicyRequest);
  sub(COMMANDS.tenantIntegrationPolicyDecide, handlePolicyDecide);
}
