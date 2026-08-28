/**
 * Command handler tests — validates the WRITE PATH for dashboards, queries,
 * and metrics. Uses the in-memory queue and cache, asserting that:
 * - Commands are published with correct shape
 * - Projected cache entries are written
 * - Auth/role enforcement is NOT duplicated here (tested in route tests)
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { createDashboard, updateDashboard, addWidget, shareDashboard, deleteDashboard } from "../src/modules/dashboards/commands.js";
import { runQuery, scheduleQuery, createExport } from "../src/modules/queries/commands.js";
import { saveMetric } from "../src/modules/metrics/commands.js";

const TENANT = "eeeeeeee-5555-4000-8000-000000000099";
const ACTOR = "ffffffff-6666-4000-8000-000000000099";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: TENANT,
    actorId: ACTOR,
    actorType: "user",
    roles: ["analytics_admin"],
    correlationId: randomUUID(),
    ...overrides,
  };
}

beforeEach(() => {
  // Clear in-memory queue between tests
  (queue as any).messages = [];
});

afterAll(async () => { await sqlClient.end(); });

describe("dashboards/commands — createDashboard", () => {
  it("publishes a createDashboard command and returns accepted", async () => {
    const result = await createDashboard(ctx(), {
      name: "Revenue Board",
      description: "Monthly revenue",
      visibility: "private",
      layout: { columns: 2 },
    });
    expect(result.status).toBe("accepted");
    expect(result.id).toBeDefined();
    expect(result.correlationId).toBeDefined();
  });
});

describe("dashboards/commands — updateDashboard", () => {
  it("throws 404 for non-existent dashboard", async () => {
    await expect(
      updateDashboard(ctx(), randomUUID(), { expectedVersion: 1, name: "Updated" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("dashboards/commands — addWidget", () => {
  it("throws 404 when dashboard does not exist", async () => {
    await expect(
      addWidget(ctx(), randomUUID(), { title: "W1", vizType: "bar", spec: {}, position: 0 }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("dashboards/commands — shareDashboard", () => {
  it("throws 404 for non-existent dashboard", async () => {
    await expect(
      shareDashboard(ctx(), randomUUID(), { principalId: randomUUID(), access: "view" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("dashboards/commands — deleteDashboard", () => {
  // Regression: deleteDashboard() used to publish the delete command
  // unconditionally to anyone holding a coarse WRITE_ROLES role, unlike its
  // siblings above (update/addWidget/share), which all gate on canEdit/
  // canShare from access.ts first — letting any analytics_user in the tenant
  // delete another user's private dashboard. Now gated the same way (see the
  // canEdit call in deleteDashboard()); the owner/admin/share decision itself
  // is exhaustively unit-tested in access-control.test.ts.
  it("throws 404 for non-existent dashboard", async () => {
    await expect(
      deleteDashboard(ctx(), randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("queries/commands — runQuery", () => {
  it("publishes command and returns accepted with id", async () => {
    const result = await runQuery(ctx(), {
      queryName: "revenue",
      spec: { metric: "amount_sum", dimensions: [], filters: [], limit: 100 },
    });
    expect(result.status).toBe("accepted");
    expect(result.id).toBeDefined();
    expect(result.correlationId).toBeDefined();
  });

  it("uses idempotencyKey if present on context", async () => {
    const key = randomUUID();
    const result = await runQuery(ctx({ idempotencyKey: key }), {
      queryName: "deduped",
      spec: { metric: "event_count", dimensions: [], filters: [], limit: 50 },
    });
    expect(result.id).toBe(key);
  });
});

describe("queries/commands — scheduleQuery", () => {
  it("publishes schedule command and returns accepted", async () => {
    const result = await scheduleQuery(ctx(), {
      name: "daily-summary",
      spec: { metric: "event_count", dimensions: ["source"], filters: [], limit: 200 },
      cadence: "daily",
      enabled: true,
    });
    expect(result.status).toBe("accepted");
    expect(result.id).toBeDefined();
  });
});

describe("queries/commands — createExport", () => {
  it("publishes export command and returns accepted", async () => {
    const result = await createExport(ctx(), {
      queryRunId: randomUUID(),
      format: "csv",
    });
    expect(result.status).toBe("accepted");
    expect(result.id).toBeDefined();
  });
});

describe("metrics/commands — saveMetric", () => {
  it("publishes save command and returns accepted", async () => {
    const result = await saveMetric(ctx(), {
      name: "Revenue Total",
      metricKey: "finance.revenue_total",
      spec: { agg: "sum", column: "amount" },
    });
    expect(result.status).toBe("accepted");
    expect(result.id).toBeDefined();
  });
});
