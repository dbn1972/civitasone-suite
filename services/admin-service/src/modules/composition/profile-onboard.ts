/**
 * Tenant-profile slice S5 — apply a NON-GOVT segment's module bundle at onboard.
 *
 * Listens for tenant.tenant.onboarded and, ONLY when TENANT_PROFILES_ENABLED === "true" AND the tenant's profile is
 * one of NON_GOVT_PROFILES, materialises the profile (applyProfileTx) and sets the gateway module-guard mode to
 * `shadow` (would-deny logged, nothing blocked). Anything else is a complete no-op, so the govt pilot is
 * byte-identical: flag off, govt_dept, govt_small_office, unknown / placeholder profiles -> return before ANY read or write
 * (not even markProcessed). The allow-list (not a govt deny-list) is deliberate: a new profile code can never
 * accidentally start composing tenants.
 *
 * Idempotent and non-clobbering: skipped if the tenant already has a composition profile (a manual
 * POST /v1/admin/composition/onboard or an earlier delivery wins) and an operator-set enforcement mode is never
 * overwritten. markProcessed + write + audit are one tenant-scoped transaction.
 *
 * Note: rule_packs on org_profile are display labels, not behaviour.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { notifyGatewayModuleCache } from "../../module-cache-notify.js";
import * as repo from "./repo.js";
import { buildRegistry, resolveComposition } from "./domain.js";
import { tenantEnforcementMode, tenantEntitlement, tenantProfile } from "./schema.js";

const log = pino({ name: "admin-composition-profile-onboard" });
const TENANT_ONBOARDED = "tenant.tenant.onboarded";
const AUDIT_TOPIC = "audit.event.record";

/** Profiles this consumer may compose. Govt profiles are intentionally absent. */
export const NON_GOVT_PROFILES: ReadonlySet<string> = new Set(["section8", "small_office", "psu"]);

/** Inlined TENANT_PROFILES_ENABLED check (same semantics as @civitasone/tenant-profile, which admin does not depend on). */
export function profilesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TENANT_PROFILES_ENABLED === "true";
}

interface OnboardedPayload {
  tenantId: string;
  edition?: string;
  profileCode?: string;
}

export function registerProfileOnboardConsumer(queue: Queue): void {
  queue.subscribe<OnboardedPayload>(TENANT_ONBOARDED, async (msg) => {
    if (!profilesEnabled()) return; // flag off: exact no-op
    const p = msg.payload;
    const tenantId = p.tenantId ?? msg.tenantId;
    const profileCode = p.profileCode ?? p.edition;
    if (!tenantId || !profileCode || !NON_GOVT_PROFILES.has(profileCode)) return; // govt / unknown: exact no-op
    try {
      const profiles = await repo.loadProfiles(tenantId);
      const chosen = profiles.find((x) => x.code === profileCode);
      if (!chosen) {
        log.warn({ tenantId, profileCode }, "org_profile row missing (migration 0062 not applied?); composition skipped");
        return;
      }
      // Validate the bundle against the registry BEFORE writing (fail loud, like the apply-plan consumer).
      const reg = buildRegistry(await repo.loadRegistry(tenantId));
      resolveComposition(reg, chosen.defaultModules);

      let applied = false;
      await runWithTenant(tenantId, () =>
        db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          const existing = await tx.select({ c: tenantProfile.profileCode }).from(tenantProfile).where(eq(tenantProfile.tenantId, tenantId)).limit(1);
          if (existing.length > 0) return; // already composed: never clobber
          // applyProfileTx DELETEs all entitlements first, so a tenant with entitlements but no profile row (apply-plan with
          // profileCode:null, 0059 carry-over) must not be composed either: only a genuinely fresh tenant is.
          const ents = await tx.select({ m: tenantEntitlement.moduleId }).from(tenantEntitlement).where(eq(tenantEntitlement.tenantId, tenantId)).limit(1);
          if (ents.length > 0) return;
          await repo.applyProfileTx(tx as unknown as Parameters<typeof repo.applyProfileTx>[0], tenantId, chosen.code, chosen.defaultModules, msg.actorId);
          const explicit = await tx.select({ m: tenantEnforcementMode.mode }).from(tenantEnforcementMode).where(eq(tenantEnforcementMode.tenantId, tenantId)).limit(1);
          if (explicit.length === 0) {
            await repo.setEnforcementModeTx(tx as unknown as Parameters<typeof repo.setEnforcementModeTx>[0], tenantId, "shadow", msg.actorId);
          }
          await enqueue(tx as Parameters<typeof enqueue>[0], {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
            tenantId: msg.tenantId ?? tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: {
              service: "admin", action: "composition_profile_onboard",
              resourceType: "tenant_composition", resourceId: tenantId, outcome: "success",
              profileCode: chosen.code, userModules: chosen.defaultModules, enforcementMode: explicit.length === 0 ? "shadow" : explicit[0]!.m,
            },
          });
          applied = true;
        }),
      );
      if (applied) {
        await cache.invalidate(cache.makeKey(tenantId, "composition", tenantId));
        await notifyGatewayModuleCache(tenantId);
      }
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: TENANT_ONBOARDED }, "Consumer processing failed");
      throw err;
    }
  });
}
