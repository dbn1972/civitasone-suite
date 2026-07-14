/**
 * Unit tests for the provisioning worker poll-loop scheduler (task 7.8, part 2/2).
 *
 * Covers: provisioning-before-I/O ordering, audit event emission on `ready`
 * and `failed`, and redacted failure logs containing no raw DSN/PII.
 *
 * Validates: Requirements 3.1, 3.5, 4.4
 *
 * `runProvisioningPollCycle`'s `findPollable` scan is intentionally
 * cross-tenant (it must see every pollable record regardless of tenant), which
 * is exactly what `install.silo_provisions`'s RLS policy blocks for a
 * non-bypassing role in a real-DB test. This suite instead mocks the module's
 * DB/repo/outbox/actuator dependencies to exercise the pure orchestration
 * logic in `processRecord` deterministically and fast, without any I/O.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbTransactionMock = vi.fn(async (fn: (tx: unknown) => unknown) => fn({}));
const enqueueMock = vi.fn(async () => undefined);
const claimProvisioningMock = vi.fn(async () => true);
const updateMock = vi.fn(async () => undefined);
const provisionSiloDatabaseMock = vi.fn();

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: dbTransactionMock },
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: enqueueMock,
}));
vi.mock("../src/modules/provisioning/repo.js", () => ({
  claimProvisioning: claimProvisioningMock,
  update: updateMock,
  findPollable: vi.fn(async () => []),
}));
vi.mock("../src/modules/provisioning/actuator.js", () => ({
  provisionSiloDatabase: provisionSiloDatabaseMock,
  listAllMigrationIds: vi.fn(() => ["svc-a/0001.sql", "svc-b/0001.sql"]),
  DEFAULT_ROOT: "/fake/repo/root",
}));
vi.mock("@civitasone/db", () => ({
  createSqlClient: vi.fn(() => ({ end: vi.fn(async () => undefined) })),
  // Scheduler now wraps claim/finalize in runWithTenant(record.tenantId, …)
  // once findPollable's cross-tenant scan has identified a record — for these
  // mocked-repo unit tests there's no real AsyncLocalStorage/RLS to exercise,
  // so just invoke fn() directly (mirrors the real function's contract).
  runWithTenant: vi.fn(async (_tenantId: string, fn: () => unknown) => fn()),
}));

const { runProvisioningPollCycle } = await import("../src/modules/provisioning/scheduler.js");
const repoModule = await import("../src/modules/provisioning/repo.js");

// Avoid a UUID whose tail is a 12-digit run — the redaction util in
// @civitasone/observability treats any 12 consecutive digits as
// Aadhaar-shaped and redacts them, even inside unrelated free text (e.g. a
// tenantId embedded in a logged error message).
const TENANT_ID = "aaaaaaaa-eeee-4000-8abc-1234567890fa";
const RECORD_ID = "bbbbbbbb-eeee-4000-8abc-1234567890fb";

function makeRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: RECORD_ID,
    tenantId: TENANT_ID,
    dbName: "civitas_tenant_aaaaaaaaeeee4000",
    status: "requested",
    steps: [],
    error: null,
    appliedMigrations: [],
    version: 1,
    requestedAt: new Date(),
    readyAt: null,
    runnerStartedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "system",
    updatedBy: "system",
    ...overrides,
  };
}

const quietLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as Parameters<
  typeof runProvisioningPollCycle
>[0] extends { logger?: infer L } ? L : never;

beforeEach(() => {
  vi.clearAllMocks();
  claimProvisioningMock.mockResolvedValue(true);
  dbTransactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}));
});

describe("runProvisioningPollCycle — provisioning-before-I/O ordering", () => {
  it("claims (transitions to provisioning) BEFORE invoking provisionSiloDatabase", async () => {
    (repoModule.findPollable as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeRecord()]);

    const callOrder: string[] = [];
    claimProvisioningMock.mockImplementationOnce(async () => {
      callOrder.push("claim");
      return true;
    });
    provisionSiloDatabaseMock.mockImplementationOnce(async () => {
      callOrder.push("actuate");
      return { status: "ready", steps: [], appliedMigrations: ["svc-a/0001.sql", "svc-b/0001.sql"] };
    });

    await runProvisioningPollCycle({ runnerDsn: "postgres://runner/db", logger: quietLogger });

    expect(callOrder).toEqual(["claim", "actuate"]);
  });

  it("skips the record entirely (never actuates) when the optimistic claim loses the race", async () => {
    (repoModule.findPollable as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeRecord()]);
    claimProvisioningMock.mockResolvedValueOnce(false); // another tick already claimed it

    const result = await runProvisioningPollCycle({ runnerDsn: "postgres://runner/db", logger: quietLogger });

    expect(provisionSiloDatabaseMock).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.ready).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("fails fast (no I/O at all) when PROVISIONING_RUNNER_DSN is unset and no runnerDsn override is given", async () => {
    const prevDsn = process.env.PROVISIONING_RUNNER_DSN;
    delete process.env.PROVISIONING_RUNNER_DSN;
    try {
      const result = await runProvisioningPollCycle({ logger: quietLogger });
      expect(result).toEqual({ scanned: 0, ready: 0, failed: 0, skipped: 0 });
      expect(repoModule.findPollable).not.toHaveBeenCalled();
      expect(provisionSiloDatabaseMock).not.toHaveBeenCalled();
    } finally {
      if (prevDsn !== undefined) process.env.PROVISIONING_RUNNER_DSN = prevDsn;
    }
  });
});

describe("runProvisioningPollCycle — audit event emission on ready and failed", () => {
  it("emits an audit.event.record completion event with tenantId/outcome/durationMs on ready", async () => {
    (repoModule.findPollable as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeRecord()]);
    provisionSiloDatabaseMock.mockResolvedValueOnce({
      status: "ready",
      steps: [{ step: "create_database", ok: true }],
      appliedMigrations: ["svc-a/0001.sql", "svc-b/0001.sql"], // matches listAllMigrationIds -> migrationsConfirmed = true
    });

    const result = await runProvisioningPollCycle({ runnerDsn: "postgres://runner/db", logger: quietLogger });

    expect(result.ready).toBe(1);
    const auditCalls = enqueueMock.mock.calls.filter(([, e]) => (e as { topic: string }).topic === "audit.event.record");
    expect(auditCalls).toHaveLength(1);
    const [, auditEvent] = auditCalls[0] as [unknown, { tenantId: string; payload: Record<string, unknown> }];
    expect(auditEvent.tenantId).toBe(TENANT_ID);
    expect(auditEvent.payload.outcome).toBe("ready");
    expect(typeof auditEvent.payload.durationMs).toBe("number");
  });

  it("emits an audit.event.record completion event with tenantId/outcome/durationMs on failed", async () => {
    (repoModule.findPollable as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeRecord()]);
    provisionSiloDatabaseMock.mockResolvedValueOnce({
      status: "failed",
      steps: [{ step: "create_database", ok: false, detail: "connection refused" }],
      appliedMigrations: [],
      failingStep: "create_database",
      error: "connection refused",
    });

    const result = await runProvisioningPollCycle({ runnerDsn: "postgres://runner/db", logger: quietLogger });

    expect(result.failed).toBe(1);
    const auditCalls = enqueueMock.mock.calls.filter(([, e]) => (e as { topic: string }).topic === "audit.event.record");
    expect(auditCalls).toHaveLength(1);
    const [, auditEvent] = auditCalls[0] as [unknown, { tenantId: string; payload: Record<string, unknown> }];
    expect(auditEvent.tenantId).toBe(TENANT_ID);
    expect(auditEvent.payload.outcome).toBe("failed");
    expect(typeof auditEvent.payload.durationMs).toBe("number");
  });

  it("only publishes the tenant.tenant.set_isolation registry-update command on ready, never on failed", async () => {
    (repoModule.findPollable as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeRecord({ id: "ready-rec" })]);
    provisionSiloDatabaseMock.mockResolvedValueOnce({
      status: "ready",
      steps: [],
      appliedMigrations: ["svc-a/0001.sql", "svc-b/0001.sql"],
    });
    await runProvisioningPollCycle({ runnerDsn: "postgres://runner/db", logger: quietLogger });
    const registryCallsOnReady = enqueueMock.mock.calls.filter(
      ([, e]) => (e as { topic: string }).topic === "tenant.tenant.set_isolation",
    );
    expect(registryCallsOnReady).toHaveLength(1);

    vi.clearAllMocks();
    claimProvisioningMock.mockResolvedValue(true);
    dbTransactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}));

    (repoModule.findPollable as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeRecord({ id: "failed-rec" })]);
    provisionSiloDatabaseMock.mockResolvedValueOnce({
      status: "failed",
      steps: [],
      appliedMigrations: [],
      failingStep: "create_database",
      error: "boom",
    });
    await runProvisioningPollCycle({ runnerDsn: "postgres://runner/db", logger: quietLogger });
    const registryCallsOnFailed = enqueueMock.mock.calls.filter(
      ([, e]) => (e as { topic: string }).topic === "tenant.tenant.set_isolation",
    );
    expect(registryCallsOnFailed).toHaveLength(0);
  });
});

describe("runProvisioningPollCycle — redacted failure logs contain no raw DSN/PII", () => {
  it("the persisted `error` and the logged failure entry never contain the raw runner DSN or a credential-shaped substring", async () => {
    (repoModule.findPollable as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeRecord()]);
    const rawError = "connection to postgres://silo_admin:s3cr3tPW@10.0.0.5:5432/postgres failed: password authentication failed";
    provisionSiloDatabaseMock.mockResolvedValueOnce({
      status: "failed",
      steps: [{ step: "create_database", ok: false, detail: rawError }],
      appliedMigrations: [],
      failingStep: "create_database",
      error: rawError,
    });

    await runProvisioningPollCycle({ runnerDsn: "postgres://runner/db", logger: quietLogger });

    // The persisted `error` (via repo.update) must be redacted — no raw DSN/password.
    const updateCall = updateMock.mock.calls[0];
    const persistedPatch = updateCall?.[2] as { error?: string } | undefined;
    expect(persistedPatch?.error).toBeDefined();
    expect(persistedPatch?.error).not.toContain("s3cr3tPW");
    expect(persistedPatch?.error).not.toContain("silo_admin:s3cr3tPW");

    // The structured log entry passed to logger.error must also be redacted
    // and must carry tenantId/failingStep/correlationId.
    const errorLogCall = (quietLogger as unknown as { error: ReturnType<typeof vi.fn> }).error.mock.calls.find(
      ([, msg]: [unknown, string]) => msg === "provisioning-scheduler: silo provisioning failed",
    );
    expect(errorLogCall).toBeDefined();
    const [loggedPayload] = errorLogCall as [Record<string, unknown>, string];
    expect(loggedPayload.tenantId).toBe(TENANT_ID);
    expect(loggedPayload.failingStep).toBe("create_database");
    expect(typeof loggedPayload.correlationId).toBe("string");
    expect(JSON.stringify(loggedPayload)).not.toContain("s3cr3tPW");
  });
});
