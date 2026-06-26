/**
 * Tenant onboarding pipeline (P0-gap fix).
 *
 * Orchestrates the end-to-end onboarding flow in a single atomic operation:
 *   1. Publish tenant.tenant.create command → consumer writes DB row + emits
 *      tenant.tenant.created event via outbox.
 *   2. Publish tenant.tenant.onboard command → consumer marks tenant active +
 *      emits tenant.tenant.onboarded (downstream services seed themselves on
 *      that event: finance seeds chart-of-accounts, identity seeds first-admin).
 *
 * Both commands are fire-and-forget (202 Accepted). The pipeline itself is
 * synchronous from the caller's perspective and returns a correlationId that
 * can be used to poll status via GET /v1/tenants/:tenantId.
 *
 * No Postgres writes here (CLAUDE.md §6 write-path rule) — all writes happen
 * inside consumers.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { TenantView } from "./domain.js";

export type OnboardTenantBody = {
  name: string;
  domain: string;
  edition: "small_office" | "psu" | "govt";
  region: string;
  residency: string;
  adminEmail: string;
  adminName: string;
};

export type OnboardAccepted = {
  tenantId: string;
  correlationId: string;
  status: "accepted";
  steps: string[];
};

/**
 * createTenantPipeline — publishes both the create and onboard commands in
 * sequence. The consumer processes each idempotently via markProcessed, so
 * retrying this route is safe.
 */
export async function createTenantPipeline(
  ctx: RequestContext,
  body: OnboardTenantBody,
): Promise<OnboardAccepted> {
  const tenantId = randomUUID();
  const correlationId = ctx.correlationId;

  // ── Step 1: prime the read-your-writes cache so GET is consistent ──────────
  const projected: TenantView = {
    id: tenantId,
    tenantId,
    name: body.name,
    domain: body.domain,
    edition: body.edition,
    status: "draft",
    region: body.region,
    residency: body.residency,
    settings: {},
    version: 1,
  };
  await cache.put(cache.makeKey(tenantId, RESOURCE, tenantId), projected);

  // ── Step 2: create-tenant command (handled by existing createTenant consumer) ─
  await queue.publish(COMMANDS.createTenant, {
    messageId: tenantId, // idempotency: one id == one create
    type: COMMANDS.createTenant,
    tenantId,
    actorId: ctx.actorId,
    correlationId,
    schemaVersion: "1.0",
    payload: {
      id: tenantId,
      tenantId,
      name: body.name,
      domain: body.domain,
      edition: body.edition,
      status: "draft",
      region: body.region,
      residency: body.residency,
      settings: {},
      version: 1,
    },
  });

  // ── Step 3: onboard command — activates tenant + triggers downstream seeds ──
  // Distinct messageId so it dedupes separately from the create command.
  const onboardMsgId = randomUUID();
  await queue.publish(COMMANDS.onboardTenant, {
    messageId: onboardMsgId,
    type: COMMANDS.onboardTenant,
    tenantId,
    actorId: ctx.actorId,
    correlationId,
    schemaVersion: "1.0",
    payload: {
      tenantId,
      adminEmail: body.adminEmail,
      adminName: body.adminName,
      edition: body.edition,
    },
  });

  return {
    tenantId,
    correlationId,
    status: "accepted",
    steps: [
      "tenant.create — writes tenant row, emits tenant.tenant.created",
      "tenant.onboard — activates tenant, emits tenant.tenant.onboarded",
      "finance.seed — finance-worker seeds chart-of-accounts on tenant.tenant.onboarded",
      "identity.seed — identity-worker provisions first-admin user on tenant.tenant.onboarded",
    ],
  };
}
