import { signToken } from "@civitasone/auth";
import { and, eq } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { scoped } from "./_tenant.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { queue } from "../src/shared/infra.js";
import { registerVendorConsumers } from "../src/modules/masters/vendor-commands.js";
import { registerAuditConsumers } from "../src/modules/audit/commands.js";
import { registerInstrumentWorkflowConsumers } from "../src/modules/instruments/commands.js";
import { registerInstrumentsConsumers } from "../src/modules/instruments/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow

/** Bearer header for (tenant, actor, roles). Each distinct actor id is a distinct person for maker != checker. */
export function bearer(tenant: string, actor: string, roles: string[]): Record<string, string> {
  return { authorization: `Bearer ${signToken({ sub: actor, tid: tenant, roles, sid: `sess-fp02-${actor.slice(-4)}` }, SECRET)}` };
}

let started = false;
/** The workflow routes publish commands; in tests the same in-process queue runs the real worker consumers. */
export async function startConsumers(): Promise<void> {
  if (started) return;
  registerVendorConsumers(queue);
  registerAuditConsumers(queue);
  registerInstrumentWorkflowConsumers(queue);
  registerInstrumentsConsumers(queue);
  await queue.start();
  started = true;
}

/** Wait until every command published so far has been fully consumed (committed, or dead-lettered). */
export async function drain(): Promise<void> {
  await (queue as unknown as MemoryQueue).drain();
}

/** audit.event.record outbox rows for one tenant filtered by action (and optional resource id). */
export async function auditRows(tenant: string, action: string, resourceId?: string) {
  const rows = await scoped(tenant, (tx) => tx.select().from(outboxMessages)
    .where(and(eq(outboxMessages.tenantId, tenant), eq(outboxMessages.topic, "audit.event.record"))));
  return rows.filter((r) => {
    const p = r.payload as { action?: string; resourceId?: string };
    return p.action === action && (resourceId === undefined || p.resourceId === resourceId);
  });
}

export async function wipeOutbox(tenant: string) {
  await scoped(tenant, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenant)));
}
