/** Citizen applications -> cross-module search (real DB): reference number, service name and status only; never the applicant. */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { findSensitive } from "@civitasone/search";
import { db, sqlClient } from "../src/shared/db.js";
import { serviceDefinitions } from "../src/modules/catalogue/schema.js";
import { insertApplication, updateApplication } from "../src/modules/application/repo.js";

const T = "88888888-5ea0-4000-8000-000000000001";
const ACTOR = "00000000-5ea0-4000-8000-0000000000a1";
const saved = { ...process.env };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const scoped = <R,>(fn: (tx: any) => Promise<R>) => withTenantScope(db, T, fn as never) as Promise<R>;
const events = async () => (await scoped((tx) => tx.execute(sql`
  SELECT payload FROM _outbox.messages WHERE tenant_id = ${T}::uuid AND topic = 'search.index.update' ORDER BY created_at, id`))) as unknown as Array<{ payload: Record<string, unknown> }>;
const wipe = () => scoped((tx) => tx.execute(sql`DELETE FROM _outbox.messages WHERE tenant_id = ${T}::uuid`));
const run = randomUUID().slice(0, 8);
const CITIZEN = randomUUID();

const app = (no: string, serviceId = randomUUID()) => ({
  id: randomUUID(), tenantId: T, citizenId: CITIZEN, serviceId, refNo: `APP-${no}-${run}`, trackingNo: `TRK-SECRET-${randomUUID()}`, applicantType: "institution",
  channel: "portal", assistedBy: randomUUID(), createdBy: ACTOR, updatedBy: ACTOR,
}) as Parameters<typeof insertApplication>[1];

describe("citizen applications -> global search producers (real DB)", () => {
  beforeEach(async () => { delete process.env.GLOBAL_SEARCH_TENANTS; await wipe(); });
  afterEach(() => { process.env = { ...saved }; });
  afterAll(async () => {
    await wipe();
    await scoped((tx) => tx.execute(sql`DELETE FROM application.citizen_applications WHERE tenant_id = ${T}::uuid`)).catch(() => undefined);
    await scoped((tx) => tx.execute(sql`DELETE FROM catalogue.service_definitions WHERE tenant_id = ${T}::uuid`)).catch(() => undefined);
    await sqlClient.end();
  });

  it("flag off: no event", async () => {
    await scoped((tx) => insertApplication(tx, app("OFF")));
    expect(await events()).toEqual([]);
  });
  it("the service name is the only descriptive field, taken from the catalogue", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    const sid = randomUUID();
    await scoped((tx) => tx.insert(serviceDefinitions).values({ id: sid, tenantId: T, serviceKey: `birth-cert-${run}`, name: "Birth certificate", createdBy: ACTOR, updatedBy: ACTOR }));
    await scoped((tx) => insertApplication(tx, app("SVC", sid)));
    expect((await events())[0]!.payload).toMatchObject({ name: `Application APP-SVC-${run}`, description: "Birth certificate" });
  });
  it("flag on: number and status only; no applicant identity, tracking number or channel", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    const a = app("1");
    await scoped((tx) => insertApplication(tx, a));
    await scoped((tx) => updateApplication(tx, a.id!, T, { status: "approved", updatedBy: ACTOR }));
    const ev = (await events()).map((e) => e.payload);
    expect(ev.map((p) => p.status)).toEqual(["submitted", "approved"]);
    expect(ev[0]).toMatchObject({ entityType: "citizen.application", module: "citizen", refNumber: `APP-1-${run}`, tenantId: T });
    const wire = JSON.stringify(ev);
    for (const s of [CITIZEN, "TRK-SECRET", "institution", "portal", a.assistedBy as string]) expect(wire).not.toContain(s);
    const { id: _i, tenantId: _t, ...content } = ev[0]!;
    expect(findSensitive(JSON.stringify(content))).toEqual([]);
    expect(Object.keys(ev[0]!).sort()).toEqual(["action", "description", "entityType", "id", "module", "name", "refNumber", "status", "tenantId"]);
  });
});
