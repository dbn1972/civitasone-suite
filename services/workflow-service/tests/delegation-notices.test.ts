/**
 * Delegation notices: creating or revoking a delegation emits workflow.delegation.created /
 * .revoked carrying what notification-service needs (roles, delegate, date range, the
 * delegator's manager from hrms). A missing manager / hrms outage fails SOFT: the delegation
 * is still written and the event still emitted with managerId null. Real DB, real command path.
 */
import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { sqlClient } from "../src/shared/db.js";

const hrms = vi.hoisted(() => ({
  lines: new Map<string, { fullName: string | null; manager: { actorId: string; fullName: string } | null }>(),
  unreachable: false,
}));
vi.mock("../src/shared/hrms-client.js", () => ({
  fetchReportingLine: async (_t: string, actor: string) => {
    if (hrms.unreachable) return { fullName: null, manager: null }; // what the real client returns on any failure
    return hrms.lines.get(actor) ?? { fullName: null, manager: null };
  },
}));
import { registerDelegationConsumers } from "../src/modules/delegations/consumer.js";
import * as delegationRepo from "../src/modules/delegations/repo.js";
import { createDelegation, revokeDelegation } from "../src/modules/delegations/commands.js";
import { EVENTS } from "../src/topics.js";
import { queue } from "../src/shared/infra.js";
import { sqlAsTenant, asTenant } from "./helpers/engine-harness.js";

registerDelegationConsumers(queue);
await queue.start();

const tenants: string[] = [];
let T = "";
const ALICE = randomUUID(), BOB = randomUUID(), MGR = randomUUID();
const ctx = (actorId: string): RequestContext =>
  ({ tenantId: T, actorId, roles: ["workflow_user"], correlationId: randomUUID(), sessionId: "s" }) as RequestContext;

beforeEach(() => { T = randomUUID(); tenants.push(T); hrms.lines.clear(); hrms.unreachable = false; });
afterEach(async () => {
  for (const t of tenants.splice(0)) {
    await sqlAsTenant(t, sql`DELETE FROM workflow.workflow_delegations WHERE tenant_id = ${t}`);
    await sqlAsTenant(t, sql`DELETE FROM _outbox.messages WHERE tenant_id = ${t}`);
  }
});
afterAll(async () => { await sqlClient.end(); });

async function events(topic: string): Promise<Array<Record<string, unknown>>> {
  const r = await sqlAsTenant(T, sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${T} AND topic = ${topic}`) as unknown as Array<{ payload: Record<string, unknown> }>;
  return r.map((x) => x.payload);
}
async function firstEvent(topic: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 160; i++) {
    const [e] = await events(topic);
    if (e) return e;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`no ${topic} event`);
}
async function create(): Promise<string> {
  const r = await createDelegation(ctx(ALICE), {
    delegateId: BOB, roles: ["estab_deputy_secretary", "estab_section_officer"], fromDate: "2026-11-01", toDate: "2026-11-15",
  });
  return r.id;
}

describe("delegation notice events", () => {
  it("create emits the enriched event with roles, delegate, dates and the delegator's manager", async () => {
    hrms.lines.set(ALICE, { fullName: "Alice A", manager: { actorId: MGR, fullName: "Meera M" } });
    hrms.lines.set(BOB, { fullName: "Bob B", manager: null });
    const id = await create();
    const ev = await firstEvent(EVENTS.delegationCreated);
    expect(ev).toMatchObject({
      id, delegatorId: ALICE, delegatorName: "Alice A", delegateId: BOB, delegateName: "Bob B",
      roles: ["estab_deputy_secretary", "estab_section_officer"], fromDate: "2026-11-01", toDate: "2026-11-15",
      managerId: MGR, managerName: "Meera M",
    });
    expect(typeof ev.occurredAt).toBe("string");
  });

  it("no manager found: the delegation is still created and the event is emitted with managerId null", async () => {
    hrms.lines.set(ALICE, { fullName: "Alice A", manager: null });
    const id = await create();
    const ev = await firstEvent(EVENTS.delegationCreated);
    expect(ev).toMatchObject({ id, delegatorId: ALICE, managerId: null, managerName: null });
    expect(await asTenant(T, () => delegationRepo.findById(id, T))).not.toBeNull();
  });

  it("hrms unreachable: fails soft, delegation + event still written", async () => {
    hrms.unreachable = true;
    const id = await create();
    const ev = await firstEvent(EVENTS.delegationCreated);
    expect(ev).toMatchObject({ id, managerId: null, delegatorName: null });
  });

  it("revoke emits the enriched event from the stored delegation", async () => {
    hrms.lines.set(ALICE, { fullName: "Alice A", manager: { actorId: MGR, fullName: "Meera M" } });
    const id = await create();
    await firstEvent(EVENTS.delegationCreated);
    await revokeDelegation(ctx(ALICE), id);
    const ev = await firstEvent(EVENTS.delegationRevoked);
    expect(ev).toMatchObject({ id, delegatorId: ALICE, delegateId: BOB, managerId: MGR, roles: ["estab_deputy_secretary", "estab_section_officer"], toDate: "2026-11-15" });
  });
});
