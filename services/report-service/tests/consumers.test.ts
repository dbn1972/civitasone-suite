/**
 * Consumer tests — covers jobs/consumer.ts, templates/consumer.ts, render/consumer.ts
 * and scheduled/cron.ts (tick function). Exercises the CQRS write path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const TENANT_ID = "aaaaaaaa-1111-4000-8000-000000000001";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "22222222-2222-2222-2222-222222222222";
const TEMPLATE_ID = "33333333-3333-3333-3333-333333333333";
const SCHEDULED_ID = "44444444-4444-4444-4444-444444444444";

// ─── Mock state ────────────────────────────────────────────────────
const mockState = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  markProcessedResult: true,
  updateCalls: [] as Record<string, unknown>[],
  enqueueCalls: [] as Record<string, unknown>[],
  publishCalls: [] as Record<string, unknown>[],
  cachePuts: [] as [string, unknown][],
  cacheInvalidations: [] as string[],
  resourceInvalidations: [] as string[],
  selectResult: [] as Record<string, unknown>[],
}));

// ─── DB Mock ───────────────────────────────────────────────────────
vi.mock("../src/shared/db.js", () => {
  const txProxy = {
    insert: () => ({ values: (v: Record<string, unknown>) => { mockState.inserted.push(v); return { returning: () => [v] }; } }),
    update: () => ({
      set: (data: Record<string, unknown>) => {
        mockState.updateCalls.push(data);
        return {
          where: () => ({
            returning: () => mockState.selectResult.length > 0 ? [mockState.selectResult[0]] : [],
          }),
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => mockState.selectResult,
        }),
      }),
    }),
  };
  return {
    db: {
      ...txProxy,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(txProxy),
    },
    sqlClient: { end: async () => {} },
  };
});

// ─── Infra Mock ────────────────────────────────────────────────────
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    put: async (key: string, val: unknown) => { mockState.cachePuts.push([key, val]); },
    invalidate: async (key: string) => { mockState.cacheInvalidations.push(key); },
    invalidateResource: async (tid: string, res: string) => { mockState.resourceInvalidations.push(`${tid}:${res}`); },
    getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(),
    listOrLoad: async <T>(_tid: string, _r: string, _k: string, loader: () => Promise<T>) => loader(),
    makeKey: (...args: string[]) => args.join(":"),
  },
  queue: {
    publish: async (topic: string, msg: unknown) => { mockState.publishCalls.push({ topic, msg }); },
    subscribe: () => {},
  },
}));

// ─── Outbox Mock ───────────────────────────────────────────────────
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: async (_tx: unknown, ev: Record<string, unknown>) => { mockState.enqueueCalls.push(ev); },
  markProcessed: async () => mockState.markProcessedResult,
}));

// ─── Jobs repo mock ────────────────────────────────────────────────
vi.mock("../src/modules/jobs/repo.js", () => ({
  insert: async (_tx: unknown, row: Record<string, unknown>) => { mockState.inserted.push(row); },
  findById: async () => mockState.selectResult[0] ?? null,
  listByTenant: async () => mockState.selectResult,
  toView: (r: Record<string, unknown>) => r,
}));

// ─── Templates repo mock ───────────────────────────────────────────
vi.mock("../src/modules/templates/repo.js", () => ({
  insert: async (_tx: unknown, row: Record<string, unknown>) => { mockState.inserted.push(row); },
  update: async () => true,
  softDelete: async () => true,
  findById: async () => mockState.selectResult[0] ?? null,
  listByTenant: async () => mockState.selectResult,
  countByTenant: async () => mockState.selectResult.length,
  toView: (r: Record<string, unknown>) => r,
}));

// ─── Scheduled repo mock ───────────────────────────────────────────
vi.mock("../src/modules/scheduled/repo.js", () => ({
  insert: async (_tx: unknown, row: Record<string, unknown>) => { mockState.inserted.push(row); },
  update: async () => true,
  disable: async () => true,
  touchLastRunAt: async () => true,
  findById: async () => mockState.selectResult[0] ?? null,
  listByTenant: async () => mockState.selectResult,
  toView: (r: Record<string, unknown>) => r,
}));

// ─── Render dependencies ───────────────────────────────────────────
vi.mock("@civitasone/render/pdf", () => ({
  renderPdf: async () => ({ buffer: Buffer.from("fake-pdf") }),
}));
vi.mock("@civitasone/render/xlsx", () => ({
  renderXlsx: async () => ({ buffer: Buffer.from("fake-xlsx") }),
  renderCsv: () => "col1,col2\nval1,val2",
}));
vi.mock("@civitasone/storage", () => ({
  putObject: async () => {},
  presignedGetUrl: async () => "https://s3.example.com/reports/test.pdf",
}));
vi.mock("drizzle-orm", () => ({
  eq: () => "eq-condition",
  and: (...args: unknown[]) => args,
  lte: () => "lte-condition",
  sql: () => "sql-fragment",
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: {
    createJob: "reports.job.create",
    renderJob: "reports.job.render",
    createTemplate: "reports.template.create",
    updateTemplate: "reports.template.update",
    deleteTemplate: "reports.template.delete",
    executeTemplate: "reports.template.execute",
    createScheduled: "reports.scheduled.create",
    updateScheduled: "reports.scheduled.update",
    disableScheduled: "reports.scheduled.disable",
    runScheduled: "reports.scheduled.run",
    scheduledGenerate: "reports.scheduled.generate",
  },
  EVENTS: {
    jobCreated: "reports.job.created",
    jobCompleted: "reports.job.completed",
    jobFailed: "reports.job.failed",
    templateCreated: "reports.template.created",
    templateUpdated: "reports.template.updated",
    templateDeleted: "reports.template.deleted",
    scheduledCreated: "reports.scheduled.created",
    scheduledUpdated: "reports.scheduled.updated",
    scheduledDisabled: "reports.scheduled.disabled",
    scheduledGenerated: "reports.scheduled.generated",
  },
  SERVICE: "reports",
  RESOURCE: "job",
}));

vi.mock("@civitasone/events", () => ({
  NOTIFICATION_SEND: "notification.send",
  buildNotificationPayload: (opts: Record<string, unknown>) => opts,
}));

// ─── Reset state between tests ────────────────────────────────────
beforeEach(() => {
  mockState.inserted = [];
  mockState.markProcessedResult = true;
  mockState.updateCalls = [];
  mockState.enqueueCalls = [];
  mockState.publishCalls = [];
  mockState.cachePuts = [];
  mockState.cacheInvalidations = [];
  mockState.resourceInvalidations = [];
  mockState.selectResult = [];
});

// ═══════════════════════════════════════════════════════════════════
// 1. Job Consumer
// ═══════════════════════════════════════════════════════════════════
describe("registerJobConsumers", () => {
  it("subscribes to createJob command and processes message", async () => {
    const { registerJobConsumers } = await import("../src/modules/jobs/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async (topic: string, msg: unknown) => { mockState.publishCalls.push({ topic, msg }); },
    };

    registerJobConsumers(mockQueue as any);
    expect(handlers.has("reports.job.create")).toBe(true);

    const msg = {
      messageId: JOB_ID,
      type: "reports.job.create",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-1",
      schemaVersion: "1.0",
      payload: {
        id: JOB_ID,
        tenantId: TENANT_ID,
        name: "Test Report",
        reportType: "finance",
        status: "queued",
        format: "pdf",
      },
    };

    await handlers.get("reports.job.create")!(msg);

    // Should have inserted the job
    expect(mockState.inserted.length).toBeGreaterThan(0);
    // Should have enqueued outbox events (job.created + audit)
    expect(mockState.enqueueCalls.length).toBe(2);
    expect(mockState.enqueueCalls[0]!.topic).toBe("reports.job.created");
    expect(mockState.enqueueCalls[1]!.topic).toBe("audit.event.record");
    // Should have cached the projected value
    expect(mockState.cachePuts.length).toBe(1);
    // Should have invalidated the resource list
    expect(mockState.resourceInvalidations.length).toBe(1);
    // Should have published render command
    expect(mockState.publishCalls.length).toBe(1);
    expect((mockState.publishCalls[0] as any).topic).toBe("reports.job.render");
  });

  it("skips processing when markProcessed returns false", async () => {
    mockState.markProcessedResult = false;
    const { registerJobConsumers } = await import("../src/modules/jobs/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async () => {},
    };

    registerJobConsumers(mockQueue as any);
    const msg = {
      messageId: "dup-msg",
      type: "reports.job.create",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-2",
      schemaVersion: "1.0",
      payload: { id: "dup-msg", tenantId: TENANT_ID, name: "Dup", status: "queued" },
    };

    await handlers.get("reports.job.create")!(msg);
    // No outbox events should be enqueued (idempotency guard)
    expect(mockState.enqueueCalls.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Template Consumer
// ═══════════════════════════════════════════════════════════════════
describe("handleCreateTemplate", () => {
  it("processes create command: markProcessed → insert → outbox → cache invalidate", async () => {
    const { handleCreateTemplate } = await import("../src/modules/templates/consumer.js");
    const ctx = { tenantId: TENANT_ID, actorId: ACTOR_ID, correlationId: "corr-3" };
    const payload = {
      id: TEMPLATE_ID,
      tenantId: TENANT_ID,
      name: "Finance Monthly",
      dataSourceId: "finance.bills",
      outputFormat: "pdf",
      status: "draft",
      version: 1,
      filters: [],
      groups: [],
      aggregations: [],
      parameters: [],
      createdBy: ACTOR_ID,
      updatedBy: ACTOR_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await handleCreateTemplate("msg-1", ctx, payload as any);

    expect(mockState.inserted.length).toBeGreaterThan(0);
    // Domain event + audit.event.record (architecture rule: every mutation audits).
    expect(mockState.enqueueCalls.length).toBe(2);
    expect(mockState.enqueueCalls[0]!.topic).toBe("reports.template.created");
    expect(mockState.enqueueCalls[1]!.topic).toBe("audit.event.record");
    expect(mockState.cacheInvalidations.length).toBe(1);
  });
});

describe("handleUpdateTemplate", () => {
  it("processes update command and invalidates cache", async () => {
    const { handleUpdateTemplate } = await import("../src/modules/templates/consumer.js");
    const ctx = { tenantId: TENANT_ID, actorId: ACTOR_ID, correlationId: "corr-4" };
    const payload = { id: TEMPLATE_ID, version: 1, name: "Updated" };

    await handleUpdateTemplate("msg-2", ctx, payload);

    expect(mockState.enqueueCalls.length).toBe(2);
    expect(mockState.enqueueCalls[0]!.topic).toBe("reports.template.updated");
    expect(mockState.enqueueCalls[1]!.topic).toBe("audit.event.record");
    expect(mockState.cacheInvalidations.length).toBe(1);
  });
});

describe("handleDeleteTemplate", () => {
  it("processes delete command and invalidates cache", async () => {
    const { handleDeleteTemplate } = await import("../src/modules/templates/consumer.js");
    const ctx = { tenantId: TENANT_ID, actorId: ACTOR_ID, correlationId: "corr-5" };
    const payload = { id: TEMPLATE_ID };

    await handleDeleteTemplate("msg-3", ctx, payload);

    expect(mockState.enqueueCalls.length).toBe(2);
    expect(mockState.enqueueCalls[0]!.topic).toBe("reports.template.deleted");
    expect(mockState.enqueueCalls[1]!.topic).toBe("audit.event.record");
    expect(mockState.cacheInvalidations.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Scheduled Consumer
// ═══════════════════════════════════════════════════════════════════
describe("registerScheduledConsumers", () => {
  it("subscribes to createScheduled and processes message", async () => {
    const { registerScheduledConsumers } = await import("../src/modules/scheduled/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async () => {},
    };

    registerScheduledConsumers(mockQueue as any);
    expect(handlers.has("reports.scheduled.create")).toBe(true);

    const msg = {
      messageId: SCHEDULED_ID,
      type: "reports.scheduled.create",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-sched-1",
      schemaVersion: "1.0",
      payload: {
        id: SCHEDULED_ID,
        tenantId: TENANT_ID,
        templateId: TEMPLATE_ID,
        cadence: "daily",
        recipients: ["admin@example.com"],
        format: "pdf",
        enabled: true,
        nextRunAt: new Date(),
        version: 1,
      },
    };

    await handlers.get("reports.scheduled.create")!(msg);

    expect(mockState.inserted.length).toBeGreaterThan(0);
    expect(mockState.enqueueCalls.length).toBe(2);
    expect(mockState.enqueueCalls[0]!.topic).toBe("reports.scheduled.created");
    expect(mockState.cacheInvalidations.length).toBeGreaterThan(0);
  });

  it("skips create when markProcessed returns false", async () => {
    mockState.markProcessedResult = false;
    const { registerScheduledConsumers } = await import("../src/modules/scheduled/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async () => {},
    };

    registerScheduledConsumers(mockQueue as any);
    await handlers.get("reports.scheduled.create")!({
      messageId: "dup-sched",
      type: "reports.scheduled.create",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-dup",
      schemaVersion: "1.0",
      payload: { id: "dup-sched", tenantId: TENANT_ID, templateId: TEMPLATE_ID, cadence: "daily", recipients: [], format: "pdf", enabled: true, nextRunAt: new Date(), version: 1 },
    });

    expect(mockState.inserted.length).toBe(0);
    expect(mockState.enqueueCalls.length).toBe(0);
  });

  it("runScheduled updates lastRunAt and publishes renderJob", async () => {
    const { registerScheduledConsumers } = await import("../src/modules/scheduled/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const publishCalls: Record<string, unknown>[] = [];
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async (topic: string, msg: unknown) => { publishCalls.push({ topic, msg }); },
    };

    registerScheduledConsumers(mockQueue as any, mockQueue as any);
    expect(handlers.has("reports.scheduled.run")).toBe(true);

    await handlers.get("reports.scheduled.run")!({
      messageId: "run-msg-1",
      type: "reports.scheduled.run",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-run",
      schemaVersion: "1.0",
      payload: {
        scheduledReportId: SCHEDULED_ID,
        jobId: JOB_ID,
        templateId: TEMPLATE_ID,
        format: "pdf",
      },
    });

    expect(mockState.enqueueCalls.some((e) => e.topic === "reports.scheduled.generated")).toBe(true);
    expect(publishCalls.length).toBe(1);
    expect(publishCalls[0]!.topic).toBe("reports.job.render");
  });
});

describe("handleUpdateScheduled", () => {
  it("processes update command and invalidates cache", async () => {
    const { handleUpdateScheduled } = await import("../src/modules/scheduled/consumer.js");
    const ctx = { tenantId: TENANT_ID, actorId: ACTOR_ID, correlationId: "corr-sched-upd" };
    await handleUpdateScheduled("msg-upd", ctx, { id: SCHEDULED_ID, version: 1, cadence: "weekly" });

    expect(mockState.enqueueCalls.length).toBe(1);
    expect(mockState.enqueueCalls[0]!.topic).toBe("reports.scheduled.updated");
    expect(mockState.cacheInvalidations.length).toBe(1);
  });
});

describe("handleDisableScheduled", () => {
  it("processes disable command and invalidates cache", async () => {
    const { handleDisableScheduled } = await import("../src/modules/scheduled/consumer.js");
    const ctx = { tenantId: TENANT_ID, actorId: ACTOR_ID, correlationId: "corr-sched-del" };
    await handleDisableScheduled("msg-del", ctx, { id: SCHEDULED_ID });

    expect(mockState.enqueueCalls.length).toBe(1);
    expect(mockState.enqueueCalls[0]!.topic).toBe("reports.scheduled.disabled");
    expect(mockState.cacheInvalidations.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Render Consumer
// ═══════════════════════════════════════════════════════════════════
describe("registerRenderConsumers", () => {
  it("subscribes to renderJob and processes PDF format", async () => {
    const { registerRenderConsumers } = await import("../src/modules/render/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async () => {},
    };

    registerRenderConsumers(mockQueue as any);
    expect(handlers.has("reports.job.render")).toBe(true);

    const msg = {
      messageId: `render-${JOB_ID}`,
      type: "reports.job.render",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-render-1",
      schemaVersion: "1.0",
      payload: {
        jobId: JOB_ID,
        tenantId: TENANT_ID,
        templateHtml: "<html><body>Test</body></html>",
        format: "pdf",
      },
    };

    await handlers.get("reports.job.render")!(msg);
    // Running-step audit + completion domain event.
    expect(mockState.updateCalls.length).toBeGreaterThan(0);
    expect(mockState.enqueueCalls.length).toBe(2);
    expect(mockState.enqueueCalls.map((e) => e.topic)).toEqual([
      "audit.event.record",
      "reports.job.completed",
    ]);
  });

  it("processes XLSX format", async () => {
    const { registerRenderConsumers } = await import("../src/modules/render/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async () => {},
    };
    registerRenderConsumers(mockQueue as any);

    const msg = {
      messageId: `render-xlsx-${JOB_ID}`,
      type: "reports.job.render",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-render-2",
      schemaVersion: "1.0",
      payload: {
        jobId: JOB_ID,
        tenantId: TENANT_ID,
        templateHtml: "<html>test</html>",
        format: "xlsx",
        columns: [{ header: "Name", key: "name" }],
        rows: [{ name: "Test" }],
        title: "Test Report",
      },
    };

    await handlers.get("reports.job.render")!(msg);
    expect(mockState.updateCalls.length).toBeGreaterThan(0);
  });

  it("processes CSV format", async () => {
    const { registerRenderConsumers } = await import("../src/modules/render/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async () => {},
    };
    registerRenderConsumers(mockQueue as any);

    const msg = {
      messageId: `render-csv-${JOB_ID}`,
      type: "reports.job.render",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-render-3",
      schemaVersion: "1.0",
      payload: {
        jobId: JOB_ID,
        tenantId: TENANT_ID,
        templateHtml: "<html>test</html>",
        format: "csv",
        columns: [{ header: "Name", key: "name" }],
        rows: [{ name: "Test" }],
      },
    };

    await handlers.get("reports.job.render")!(msg);
    expect(mockState.updateCalls.length).toBeGreaterThan(0);
  });

  it("processes HTML format (default)", async () => {
    const { registerRenderConsumers } = await import("../src/modules/render/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async () => {},
    };
    registerRenderConsumers(mockQueue as any);

    const msg = {
      messageId: `render-html-${JOB_ID}`,
      type: "reports.job.render",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-render-4",
      schemaVersion: "1.0",
      payload: {
        jobId: JOB_ID,
        tenantId: TENANT_ID,
        templateHtml: "<html><body>HTML Report</body></html>",
        format: "html",
      },
    };

    await handlers.get("reports.job.render")!(msg);
    expect(mockState.updateCalls.length).toBeGreaterThan(0);
  });

  it("marks job as failed when render throws", async () => {
    // Override renderPdf to throw
    vi.doMock("@civitasone/render/pdf", () => ({
      renderPdf: async () => { throw new Error("render failure"); },
    }));

    // Re-import to pick up the new mock
    vi.resetModules();
    // Re-apply all other mocks
    vi.doMock("../src/shared/db.js", () => {
      const txProxy = {
        insert: () => ({ values: () => ({ returning: () => [{}] }) }),
        update: () => ({
          set: (data: Record<string, unknown>) => {
            mockState.updateCalls.push(data);
            return { where: () => ({ returning: () => [{}] }) };
          },
        }),
        select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }),
      };
      return {
        db: { ...txProxy, transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(txProxy) },
        sqlClient: { end: async () => {} },
      };
    });
    vi.doMock("../src/shared/infra.js", () => ({
      cache: {
        put: async () => {},
        invalidate: async (key: string) => { mockState.cacheInvalidations.push(key); },
        invalidateResource: async () => {},
        makeKey: (...args: string[]) => args.join(":"),
      },
      queue: { publish: async () => {}, subscribe: () => {} },
    }));
    vi.doMock("../src/shared/outbox.js", () => ({
      enqueue: async () => {},
      markProcessed: async () => true,
    }));

    vi.doMock("@civitasone/render/pdf", () => ({
      renderPdf: async () => { throw new Error("render failure"); },
    }));
    vi.doMock("@civitasone/render/xlsx", () => ({
      renderXlsx: async () => ({ buffer: Buffer.from("x") }),
      renderCsv: () => "",
    }));
    vi.doMock("@civitasone/storage", () => ({
      putObject: async () => {},
      presignedGetUrl: async () => "https://s3.example.com/test.pdf",
    }));
    vi.doMock("drizzle-orm", () => ({
      eq: () => "eq",
      and: (...args: unknown[]) => args,
      lte: () => "lte",
      sql: () => "sql",
    }));
    vi.doMock("../src/topics.js", () => ({
      COMMANDS: { renderJob: "reports.job.render" },
      EVENTS: { jobCompleted: "reports.job.completed", jobFailed: "reports.job.failed" },
      SERVICE: "reports",
      RESOURCE: "job",
    }));

    const { registerRenderConsumers: reg } = await import("../src/modules/render/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async () => {},
    };
    reg(mockQueue as any);

    const msg = {
      messageId: `render-fail-${JOB_ID}`,
      type: "reports.job.render",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-fail",
      schemaVersion: "1.0",
      payload: { jobId: JOB_ID, tenantId: TENANT_ID, templateHtml: "<html></html>", format: "pdf" },
    };

    await handlers.get("reports.job.render")!(msg);
    // Job status should be set to "failed"
    const failUpdate = mockState.updateCalls.find((u) => u.status === "failed");
    expect(failUpdate).toBeDefined();
  });
});
