/**
 * Tenant isolation (RLS) — proves visit_requests, digital_passes, and
 * check_ins rows are invisible across tenants under the real Postgres
 * `app.tenant_id` GUC / tenant_isolation_policy, not merely by an app-layer
 * WHERE clause. `visitor_svc` is a NOBYPASSRLS role (migration 0009), so a
 * direct id lookup for another tenant's row must return zero rows even
 * though the query itself carries no tenant filter.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../src/shared/db.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { checkIns } from "../src/modules/check-in/schema.js";
import { locations, gates } from "../src/modules/location/schema.js";

const BUSINESS_HOURS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
};

type Fixture = {
  tenant: string;
  location: string;
  gate: string;
  actor: string;
  host: string;
  visitRequest: string;
  digitalPass: string;
  checkIn: string;
};

function makeFixture(): Fixture {
  return {
    tenant: randomUUID(),
    location: randomUUID(),
    gate: randomUUID(),
    actor: randomUUID(),
    host: randomUUID(),
    visitRequest: randomUUID(),
    digitalPass: randomUUID(),
    checkIn: randomUUID(),
  };
}

async function seed(f: Fixture): Promise<void> {
  await runWithTenant(f.tenant, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({
        id: f.location,
        tenantId: f.tenant,
        name: `Location ${f.tenant}`,
        businessHours: BUSINESS_HOURS,
        createdBy: f.actor,
        updatedBy: f.actor,
      });
      await tx.insert(gates).values({
        id: f.gate,
        tenantId: f.tenant,
        locationId: f.location,
        name: `Gate ${f.tenant}`,
        createdBy: f.actor,
        updatedBy: f.actor,
      });
      await tx.insert(visitRequests).values({
        id: f.visitRequest,
        tenantId: f.tenant,
        locationId: f.location,
        hostEmployeeId: f.host,
        visitorName: `Visitor ${f.tenant}`,
        visitorPhone: "+911234500000",
        createdBy: f.actor,
        updatedBy: f.actor,
      });
      await tx.insert(digitalPasses).values({
        id: f.digitalPass,
        tenantId: f.tenant,
        visitRequestId: f.visitRequest,
        locationId: f.location,
        passNumber: f.tenant.slice(0, 8),
        passType: "single",
        qrJwt: "test.qr.jwt",
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 86_400_000),
        createdBy: f.actor,
        updatedBy: f.actor,
      });
      await tx.insert(checkIns).values({
        id: f.checkIn,
        tenantId: f.tenant,
        passId: f.digitalPass,
        locationId: f.location,
        gateId: f.gate,
        direction: "in",
        createdBy: f.actor,
      });
    }),
  );
}

async function cleanup(f: Fixture): Promise<void> {
  await runWithTenant(f.tenant, () =>
    db.transaction(async (tx) => {
      await tx.delete(checkIns).where(eq(checkIns.id, f.checkIn));
      await tx.delete(digitalPasses).where(eq(digitalPasses.id, f.digitalPass));
      await tx.delete(visitRequests).where(eq(visitRequests.id, f.visitRequest));
      await tx.delete(gates).where(eq(gates.id, f.gate));
      await tx.delete(locations).where(eq(locations.id, f.location));
    }),
  );
}

const tenantA = makeFixture();
const tenantB = makeFixture();

beforeAll(async () => {
  await seed(tenantA);
  await seed(tenantB);
});

afterAll(async () => {
  await cleanup(tenantA);
  await cleanup(tenantB);
});

describe("tenant isolation (RLS) — visit_requests / digital_passes / check_ins", () => {
  it("visit_requests: tenant A cannot read tenant B's row by id", async () => {
    const rowsAsA = await runWithTenant(tenantA.tenant, () =>
      scopedRead((tx) => tx.select().from(visitRequests).where(eq(visitRequests.id, tenantB.visitRequest))),
    );
    expect(rowsAsA).toHaveLength(0);

    const rowsAsB = await runWithTenant(tenantB.tenant, () =>
      scopedRead((tx) => tx.select().from(visitRequests).where(eq(visitRequests.id, tenantB.visitRequest))),
    );
    expect(rowsAsB).toHaveLength(1);
  });

  it("digital_passes: tenant A cannot read tenant B's row by id", async () => {
    const rowsAsA = await runWithTenant(tenantA.tenant, () =>
      scopedRead((tx) => tx.select().from(digitalPasses).where(eq(digitalPasses.id, tenantB.digitalPass))),
    );
    expect(rowsAsA).toHaveLength(0);

    const rowsAsB = await runWithTenant(tenantB.tenant, () =>
      scopedRead((tx) => tx.select().from(digitalPasses).where(eq(digitalPasses.id, tenantB.digitalPass))),
    );
    expect(rowsAsB).toHaveLength(1);
  });

  it("check_ins: tenant A cannot read tenant B's row by id", async () => {
    const rowsAsA = await runWithTenant(tenantA.tenant, () =>
      scopedRead((tx) => tx.select().from(checkIns).where(eq(checkIns.id, tenantB.checkIn))),
    );
    expect(rowsAsA).toHaveLength(0);

    const rowsAsB = await runWithTenant(tenantB.tenant, () =>
      scopedRead((tx) => tx.select().from(checkIns).where(eq(checkIns.id, tenantB.checkIn))),
    );
    expect(rowsAsB).toHaveLength(1);
  });

  it("visit_requests: each tenant only sees its own row in an unfiltered scan of both ids", async () => {
    const idsAsA = await runWithTenant(tenantA.tenant, () =>
      scopedRead((tx) => tx.select({ id: visitRequests.id }).from(visitRequests)),
    );
    const ids = idsAsA.map((r) => r.id);
    expect(ids).toContain(tenantA.visitRequest);
    expect(ids).not.toContain(tenantB.visitRequest);
  });
});
