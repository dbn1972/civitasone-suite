/**
 * UAT owner decision #17 (GAP-REPORTS-LIST-04), render side:
 *  - PII columns are masked BY DEFAULT: no role (not even super_admin) skips masking.
 *  - The only way to export unmasked is an explicit grant carrying a reason, issued
 *    by the job requester; a blank reason or a grant for another actor is ignored.
 *  - Every PII export is audited (masked or not); an unmasked one carries the reason.
 *  - The job stores the storage key, never a presigned bearer URL (links are minted
 *    on download with a 15-minute expiry).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const TENANT_ID = "aaaaaaaa-1111-4000-8000-000000000001";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "55555555-5555-5555-5555-555555555555";

const mockState = vi.hoisted(() => ({
  updateCalls: [] as Record<string, unknown>[],
  enqueueCalls: [] as Record<string, unknown>[],
  uploadedBuffers: [] as Buffer[],
  presignCalls: [] as Array<{ key: string; expiresIn?: number }>,
}));

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
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    put: async () => {}, invalidate: async () => {}, invalidateResource: async () => {},
    getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(),
    makeKey: (...args: string[]) => args.join(":"),
  },
  queue: { publish: async () => {}, subscribe: () => {} },
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: async (_tx: unknown, ev: Record<string, unknown>) => { mockState.enqueueCalls.push(ev); },
  markProcessed: async () => true,
}));
vi.mock("@civitasone/render/pdf", () => ({ renderPdf: async () => ({ buffer: Buffer.from("x"), mode: "html-only", signed: false }) }));
vi.mock("@civitasone/render/xlsx", () => ({
  renderXlsx: async () => ({ buffer: Buffer.from("x"), rowCount: 0 }),
  renderCsv: (cols: Array<{ header: string; key: string }>, rows: Record<string, unknown>[]) =>
    [cols.map((c) => c.header).join(","), ...rows.map((r) => cols.map((c) => String(r[c.key] ?? "")).join(","))].join("\n"),
}));
vi.mock("@civitasone/storage", () => ({
  putObject: async (_k: string, buffer: Buffer) => { mockState.uploadedBuffers.push(buffer); },
  presignedGetUrl: async (o: { key: string; expiresIn?: number }) => { mockState.presignCalls.push(o); return "https://s3.example.com/signed"; },
}));
vi.mock("drizzle-orm", () => ({ eq: () => "eq", and: (...a: unknown[]) => a }));
vi.mock("../src/topics.js", () => ({
  COMMANDS: { renderJob: "reports.job.render" },
  EVENTS: { jobCompleted: "reports.job.completed" },
  SERVICE: "reports", RESOURCE: "job",
}));
vi.mock("../src/shared/tenant-queue.js", () => ({ tenantScoped: (q: unknown) => q }));

beforeEach(() => {
  mockState.updateCalls = []; mockState.enqueueCalls = []; mockState.uploadedBuffers = []; mockState.presignCalls = [];
});

async function run(extra: Record<string, unknown>, actorId = ACTOR_ID) {
  const { registerRenderConsumers } = await import("../src/modules/render/consumer.js");
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  registerRenderConsumers({ subscribe: (t: string, h: (m: unknown) => Promise<void>) => { handlers.set(t, h); }, publish: async () => {} } as any);
  await handlers.get("reports.job.render")!({
    messageId: `m-${Math.random()}`, type: "reports.job.render", tenantId: TENANT_ID, actorId,
    correlationId: "corr", schemaVersion: "1.0",
    payload: {
      jobId: JOB_ID, tenantId: TENANT_ID, templateHtml: "", format: "csv",
      columns: [{ header: "Name", key: "name" }, { header: "Email", key: "email" }],
      rows: [{ name: "Jane Roe", email: "jane@example.com" }],
      piiColumns: ["email"],
      ...extra,
    },
  });
  return mockState.uploadedBuffers[0]!.toString("utf-8");
}
const audits = () => mockState.enqueueCalls.filter((e) => e.topic === "audit.event.record").map((e) => e.payload as Record<string, unknown>);

describe("owner decision #17 — PII exports are masked by default", () => {
  it("masks PII columns when the payload names no role at all", async () => {
    const csv = await run({});
    expect(csv).toContain("ja***m");
    expect(csv).not.toContain("jane@example.com");
    expect(csv).toContain("Jane Roe");
  });

  it("masks for super_admin too (no role skips masking)", async () => {
    const csv = await run({ actorRole: "super_admin", piiAllowedRoles: ["super_admin"] });
    expect(csv).not.toContain("jane@example.com");
  });

  it("exports unmasked only with a grant carrying a reason, and audits it with that reason", async () => {
    const reason = "DPO-approved audit request 42";
    const csv = await run({ piiUnmask: { reason, grantedBy: ACTOR_ID } });
    expect(csv).toContain("jane@example.com");
    const a = audits().find((p) => p.action === "export_unmasked");
    expect(a).toBeDefined();
    expect(a).toMatchObject({ service: "report-service", resourceType: "report_job", resourceId: JOB_ID, outcome: "success", unmaskReason: reason, unmaskedBy: ACTOR_ID });
    expect(JSON.stringify(a)).not.toContain("jane@example.com");
  });

  it("ignores a grant with a blank reason", async () => {
    const csv = await run({ piiUnmask: { reason: "   ", grantedBy: ACTOR_ID } });
    expect(csv).not.toContain("jane@example.com");
  });

  it("ignores a grant issued for a different actor", async () => {
    const csv = await run({ piiUnmask: { reason: "valid enough reason", grantedBy: "99999999-9999-9999-9999-999999999999" } });
    expect(csv).not.toContain("jane@example.com");
  });

  it("audits a masked PII export without any row data", async () => {
    await run({});
    const a = audits().find((p) => p.action === "export");
    expect(a).toMatchObject({ resourceType: "report_job", resourceId: JOB_ID, piiMasked: true, piiColumnCount: 1 });
    expect(JSON.stringify(a)).not.toContain("jane");
  });
});

describe("owner decision #17 — no long-lived bearer URL is minted at render time", () => {
  it("stores the storage key and presigns nothing", async () => {
    await run({});
    const done = mockState.updateCalls.find((u) => u.status === "completed")!;
    expect(done.downloadUrl).toBe(`reports/${TENANT_ID}/${JOB_ID}.csv`);
    expect(mockState.presignCalls).toHaveLength(0);
    const completed = mockState.enqueueCalls.find((e) => e.topic === "reports.job.completed")!;
    expect(JSON.stringify(completed.payload)).not.toContain("http");
  });
});
