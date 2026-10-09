/**
 * GAP2-ANALYTICS-ROLES-01 + GAP2-ANALYTICS-DATA-WAREHOUSE-01
 *
 * ROLES-01: the analytics read routes had two non-overlapping reader
 * vocabularies — `analytics_viewer` (kpi/data-warehouse/ai-insights/exports)
 * vs `analytics_user` (dashboards/queries/metrics/stream). A user holding
 * only `analytics_user` was 403'd on the KPI/Data-Warehouse/AI-Insights/
 * Exports tiles the same hub advertises. After the fix a single canonical
 * reader set (union of both names) is applied uniformly, so `analytics_user`
 * gets 200 on GET /v1/analytics/kpis (today it was 403).
 *
 * DATA-WAREHOUSE-01: the dataset inventory stamped `lastRefresh = now` on
 * every request and a blanket `status = "Healthy"`. After the fix lastRefresh
 * is derived from the real max(occurred_at) of the source's fact_events (so
 * two sequential calls do not both read the current wall-clock minute) and
 * status is "—" (unknown), not unconditionally "Healthy".
 *
 * DB-backed (RLS) following tenant-isolation.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { factEvents } from "../src/modules/facts/schema.js";
import * as factsRepo from "../src/modules/facts/repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-dw-01" }, SECRET);
}

// A fact ingested well in the PAST, so lastRefresh must NOT equal "now".
const PAST = new Date("2023-01-02T03:04:00.000Z");

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      factsRepo.ingest(tx, {
        tenantId: TENANT,
        source: "finance",
        eventType: "payment.released",
        category: "general",
        status: "recorded",
        amount: 100n,
        occurredAt: PAST,
        dedupeKey: randomUUID(),
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    ),
  );
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.delete(factEvents).where(eq(factEvents.tenantId, TENANT))),
  );
  await sqlClient.end();
});

describe("GAP2-ANALYTICS-ROLES-01: analytics_user is a valid analytics reader", () => {
  it("GET /v1/analytics/kpis returns 200 for an analytics_user token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/kpis",
      headers: { authorization: `Bearer ${token(["analytics_user"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200); // was 403 before the fix
  });

  it("GET /v1/analytics/data-warehouse also returns 200 for analytics_user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/data-warehouse",
      headers: { authorization: `Bearer ${token(["analytics_user"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});

describe("GAP2-ANALYTICS-DATA-WAREHOUSE-01: honest lastRefresh + status", () => {
  it("lastRefresh reflects the fact's real occurred_at, not request time; status is not 'Healthy'", async () => {
    const app = await buildApp();
    const call = () =>
      app.inject({
        method: "GET",
        url: "/v1/analytics/data-warehouse",
        headers: { authorization: `Bearer ${token(["analytics_admin"])}` },
      });
    const res1 = await call();
    const res2 = await call();
    await app.close();

    expect(res1.statusCode).toBe(200);
    const row1 = res1.json().data.find((r: { dataset: string }) => r.dataset === "finance");
    const row2 = res2.json().data.find((r: { dataset: string }) => r.dataset === "finance");
    expect(row1).toBeTruthy();

    // lastRefresh derives from the PAST occurred_at (2023-01-02 03:04), NOT now.
    expect(row1.lastRefresh.startsWith("2023-01-02")).toBe(true);
    const nowMinute = new Date().toISOString().slice(0, 16).replace("T", " ");
    expect(row1.lastRefresh).not.toBe(nowMinute);
    // two sequential calls do not both return the current wall-clock minute
    expect(row2.lastRefresh).toBe(row1.lastRefresh);

    // status is no longer a blanket "Healthy"
    expect(row1.status).not.toBe("Healthy");
  });
});
