/**
 * Watermark + PII masking integration test for the render consumer.
 *
 * Verifies that:
 * - Templates with watermark produce exports with watermark applied
 * - Templates with piiColumns mask PII for non-admin roles
 * - Non-PII columns remain visible
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const TENANT_ID = "aaaaaaaa-1111-4000-8000-000000000001";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "55555555-5555-5555-5555-555555555555";

// ─── Mock state ────────────────────────────────────────────────────
const mockState = vi.hoisted(() => ({
  updateCalls: [] as Record<string, unknown>[],
  enqueueCalls: [] as Record<string, unknown>[],
  cacheInvalidations: [] as string[],
  uploadedBuffers: [] as Buffer[],
  uploadedKeys: [] as string[],
  markProcessedResult: true,
}));

// ─── DB Mock ───────────────────────────────────────────────────────
vi.mock("../src/shared/db.js", () => {
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

// ─── Infra Mock ────────────────────────────────────────────────────
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    put: async () => {},
    invalidate: async (key: string) => { mockState.cacheInvalidations.push(key); },
    invalidateResource: async () => {},
    getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(),
    makeKey: (...args: string[]) => args.join(":"),
  },
  queue: { publish: async () => {}, subscribe: () => {} },
}));

// ─── Outbox Mock ───────────────────────────────────────────────────
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: async (_tx: unknown, ev: Record<string, unknown>) => { mockState.enqueueCalls.push(ev); },
  markProcessed: async () => mockState.markProcessedResult,
}));

// ─── Render dependencies ───────────────────────────────────────────
vi.mock("@civitasone/render/pdf", () => ({
  renderPdf: async () => ({ buffer: Buffer.from("<html>rendered</html>", "utf-8"), mode: "html-only", signed: false }),
}));
vi.mock("@civitasone/render/xlsx", () => ({
  renderXlsx: async (opts: { rows: Record<string, unknown>[] }) => {
    // Return a buffer that encodes the rows for verification
    return { buffer: Buffer.from(JSON.stringify(opts.rows), "utf-8"), rowCount: opts.rows.length };
  },
  renderCsv: (cols: Array<{ header: string; key: string }>, rows: Record<string, unknown>[]) => {
    const header = cols.map((c) => c.header).join(",");
    const data = rows.map((r) => cols.map((c) => String(r[c.key] ?? "")).join(","));
    return [header, ...data].join("\n");
  },
}));

vi.mock("@civitasone/storage", () => ({
  putObject: async (key: string, buffer: Buffer) => {
    mockState.uploadedKeys.push(key);
    mockState.uploadedBuffers.push(buffer);
  },
  presignedGetUrl: async () => "https://s3.example.com/reports/test.pdf",
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq-condition",
  and: (...args: unknown[]) => args,
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: { renderJob: "reports.job.render" },
  EVENTS: { jobCompleted: "reports.job.completed" },
  SERVICE: "reports",
  RESOURCE: "job",
}));

vi.mock("../src/shared/tenant-queue.js", () => ({
  tenantScoped: (q: unknown) => q,
}));

// ─── Reset state between tests ────────────────────────────────────
beforeEach(() => {
  mockState.updateCalls = [];
  mockState.enqueueCalls = [];
  mockState.cacheInvalidations = [];
  mockState.uploadedBuffers = [];
  mockState.uploadedKeys = [];
  mockState.markProcessedResult = true;
});

describe("render consumer with watermark", () => {
  it("applies PDF watermark when payload includes watermark text", async () => {
    const { registerRenderConsumers } = await import("../src/modules/render/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async () => {},
    };

    registerRenderConsumers(mockQueue as any);

    const msg = {
      messageId: `wm-pdf-${JOB_ID}`,
      type: "reports.job.render",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-wm-1",
      schemaVersion: "1.0",
      payload: {
        jobId: JOB_ID,
        tenantId: TENANT_ID,
        templateHtml: "<html><body>Report</body></html>",
        format: "pdf",
        watermark: "CONFIDENTIAL — TestTenant — 2026-07-15",
      },
    };

    await handlers.get("reports.job.render")!(msg);

    // The uploaded buffer should contain the watermark text
    expect(mockState.uploadedBuffers.length).toBe(1);
    const content = mockState.uploadedBuffers[0]!.toString("utf-8");
    expect(content).toContain("CONFIDENTIAL");
    expect(content).toContain("TestTenant");
  });

  it("applies CSV watermark as comment line", async () => {
    const { registerRenderConsumers } = await import("../src/modules/render/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async () => {},
    };

    registerRenderConsumers(mockQueue as any);

    const msg = {
      messageId: `wm-csv-${JOB_ID}`,
      type: "reports.job.render",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-wm-2",
      schemaVersion: "1.0",
      payload: {
        jobId: JOB_ID,
        tenantId: TENANT_ID,
        templateHtml: "",
        format: "csv",
        columns: [{ header: "Name", key: "name" }, { header: "Amount", key: "amount" }],
        rows: [{ name: "Item A", amount: 1000 }],
        watermark: "DRAFT — Internal Use Only",
      },
    };

    await handlers.get("reports.job.render")!(msg);

    expect(mockState.uploadedBuffers.length).toBe(1);
    const csv = mockState.uploadedBuffers[0]!.toString("utf-8");
    expect(csv.startsWith("# DRAFT — Internal Use Only\n")).toBe(true);
    expect(csv).toContain("Name,Amount");
  });
});

describe("render consumer with PII masking", () => {
  it("masks PII columns for non-allowed roles", async () => {
    const { registerRenderConsumers } = await import("../src/modules/render/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async () => {},
    };

    registerRenderConsumers(mockQueue as any);

    const msg = {
      messageId: `pii-csv-${JOB_ID}`,
      type: "reports.job.render",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-pii-1",
      schemaVersion: "1.0",
      payload: {
        jobId: JOB_ID,
        tenantId: TENANT_ID,
        templateHtml: "",
        format: "csv",
        columns: [
          { header: "Name", key: "name" },
          { header: "Email", key: "email" },
          { header: "Phone", key: "phone" },
        ],
        rows: [
          { name: "John Smith", email: "john@example.com", phone: "9876543210" },
        ],
        piiColumns: ["email", "phone"],
        actorRole: "report_user",
        piiAllowedRoles: ["super_admin", "hr_admin"],
      },
    };

    await handlers.get("reports.job.render")!(msg);

    expect(mockState.uploadedBuffers.length).toBe(1);
    const csv = mockState.uploadedBuffers[0]!.toString("utf-8");
    // Name should be visible
    expect(csv).toContain("John Smith");
    // Email and phone should be masked
    expect(csv).toContain("jo***m"); // john@example.com → jo***m
    expect(csv).toContain("98***0"); // 9876543210 → 98***0
    // Raw PII should NOT appear
    expect(csv).not.toContain("john@example.com");
    expect(csv).not.toContain("9876543210");
  });

  it("does NOT mask PII columns for allowed roles", async () => {
    const { registerRenderConsumers } = await import("../src/modules/render/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async () => {},
    };

    registerRenderConsumers(mockQueue as any);

    const msg = {
      messageId: `pii-admin-${JOB_ID}`,
      type: "reports.job.render",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-pii-2",
      schemaVersion: "1.0",
      payload: {
        jobId: JOB_ID,
        tenantId: TENANT_ID,
        templateHtml: "",
        format: "csv",
        columns: [
          { header: "Name", key: "name" },
          { header: "Email", key: "email" },
        ],
        rows: [
          { name: "Jane Doe", email: "jane@example.com" },
        ],
        piiColumns: ["email"],
        actorRole: "super_admin",
        piiAllowedRoles: ["super_admin"],
      },
    };

    await handlers.get("reports.job.render")!(msg);

    expect(mockState.uploadedBuffers.length).toBe(1);
    const csv = mockState.uploadedBuffers[0]!.toString("utf-8");
    // Email should be visible for super_admin
    expect(csv).toContain("jane@example.com");
  });

  it("applies both watermark and PII masking together", async () => {
    const { registerRenderConsumers } = await import("../src/modules/render/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async () => {},
    };

    registerRenderConsumers(mockQueue as any);

    const msg = {
      messageId: `both-${JOB_ID}`,
      type: "reports.job.render",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-both",
      schemaVersion: "1.0",
      payload: {
        jobId: JOB_ID,
        tenantId: TENANT_ID,
        templateHtml: "",
        format: "csv",
        columns: [
          { header: "Name", key: "name" },
          { header: "PAN", key: "pan" },
        ],
        rows: [
          { name: "Employee A", pan: "ABCDE1234F" },
        ],
        piiColumns: ["pan"],
        actorRole: "finance_officer",
        piiAllowedRoles: ["super_admin"],
        watermark: "STRICTLY CONFIDENTIAL",
      },
    };

    await handlers.get("reports.job.render")!(msg);

    expect(mockState.uploadedBuffers.length).toBe(1);
    const csv = mockState.uploadedBuffers[0]!.toString("utf-8");
    // Watermark present
    expect(csv.startsWith("# STRICTLY CONFIDENTIAL\n")).toBe(true);
    // PAN is masked
    expect(csv).toContain("AB***F");
    expect(csv).not.toContain("ABCDE1234F");
    // Name is visible
    expect(csv).toContain("Employee A");
  });
});
