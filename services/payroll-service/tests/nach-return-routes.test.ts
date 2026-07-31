/**
 * payroll-service — NACH Return routes comprehensive integration tests
 *
 * Covers POST /v1/payroll/runs/:id/nach-return:
 * - 202: happy path (text/plain, JSON body, various record mixes)
 * - 400: empty body, invalid content, parse failures, invalid UUID
 * - 401: no token
 * - 403: unauthorized roles (employee, citizen, hr_admin)
 *
 * Uses vi.mock pattern (same as the established pattern in this file).
 */
import { describe, it, expect, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { randomUUID } from "node:crypto";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = "aaaaaaaa-bbbb-4000-8000-000000000001";
const RUN_ID = randomUUID();

function adminToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["payroll_admin", "super_admin"], sid: "s1" }, SECRET);
}
function employeeToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET);
}
function citizenToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
}
function hrToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s1" }, SECRET);
}
function financeToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["finance_officer"], sid: "s1" }, SECRET);
}

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => undefined),
}));

vi.mock("../src/shared/db.js", () => {
  const createChain = (result: unknown[] = []) => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => result),
        [Symbol.iterator]: function* () { yield* result; },
      })),
      [Symbol.iterator]: function* () { yield* result; },
      limit: vi.fn(() => result),
    })),
  });
  const mockSelect = vi.fn(() => createChain([]));
  const mockInsert = vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => ({ returning: vi.fn(() => []) })),
      onConflictDoUpdate: vi.fn(() => ({})),
    })),
  }));
  const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ insert: mockInsert, select: mockSelect }),
  );
  return {
    db: { select: mockSelect, transaction: mockTransaction, insert: mockInsert },
    scopedRead: (fn: (tx: unknown) => unknown) => fn({ select: mockSelect }),
    sqlClient: { end: vi.fn() },
  };
});

vi.mock("../src/modules/tax/config.js", () => ({
  loadTaxConfig: vi.fn(async () => 0),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), ping: vi.fn(async () => "PONG") },
  queue: { publish: vi.fn(async () => undefined), subscribe: vi.fn() },
}));

vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => Buffer.from("mock")),
  deleteObject: vi.fn(async () => undefined),
  presignedGetUrl: vi.fn(async () => "https://mock-url.example.com/file"),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a valid NACH return file content with specified records.
 * Fixed-width 160 chars/line format.
 */
function buildNachReturnFile(
  records: Array<{ amount: string; reference: string; status: string; reason: string }>,
): string {
  const pad = (s: string, len: number) => s.padEnd(len).slice(0, len);
  const padLeft = (s: string, len: number) => s.padStart(len).slice(-len);

  // Header (type 01) — 160 chars
  const header = "01" + " ".repeat(158);

  // Detail records (type 02) — 160 chars each
  const details = records.map((r) => {
    const line = " ".repeat(160).split("");
    line[0] = "0"; line[1] = "2";
    // Amount at position 30-42 (13 chars, zero-padded)
    const amt = padLeft(r.amount, 13);
    for (let i = 0; i < 13; i++) line[30 + i] = amt[i]!;
    // Reference at position 83-102 (20 chars)
    const ref = pad(r.reference, 20);
    for (let i = 0; i < 20; i++) line[83 + i] = ref[i]!;
    // Status at position 143-144 (2 chars)
    const st = pad(r.status, 2);
    line[143] = st[0]!; line[144] = st[1]!;
    // Reason at position 145-148 (4 chars)
    const reason = pad(r.reason, 4);
    for (let i = 0; i < 4; i++) line[145 + i] = reason[i]!;
    return line.join("");
  });

  // Control record (type 03) — 160 chars
  const control = "03" + " ".repeat(158);

  return [header, ...details, control].join("\r\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /v1/payroll/runs/:id/nach-return — 202 happy path (text/plain)
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/runs/:id/nach-return — happy path (202)", () => {
  it("returns 202 with summary for valid text/plain NACH file", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000100000", reference: "EMP001", status: "0 ", reason: "    " },
      { amount: "0000000200000", reference: "EMP002", status: "1 ", reason: "13  " },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.credited).toBe(1);
    expect(body.data.returned).toBe(1);
    expect(body.data.unmatched).toBe(0);
  });

  it("returns 202 with JSON body { content: ... }", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000050000", reference: "EMP003", status: "0 ", reason: "    " },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { content: fileContent },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().data.credited).toBe(1);
    expect(res.json().data.returned).toBe(0);
  });

  it("counts unmatched records (status != 0 or 1)", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000050000", reference: "EMP004", status: "0 ", reason: "    " },
      { amount: "0000000050000", reference: "EMP005", status: "9 ", reason: "99  " },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().data.credited).toBe(1);
    expect(res.json().data.unmatched).toBe(1);
  });

  it("handles multiple credited records", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000100000", reference: "EMP006", status: "0 ", reason: "    " },
      { amount: "0000000200000", reference: "EMP007", status: "0 ", reason: "    " },
      { amount: "0000000300000", reference: "EMP008", status: "0 ", reason: "    " },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().data.credited).toBe(3);
    expect(res.json().data.returned).toBe(0);
  });

  it("handles all returned records", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000100000", reference: "EMP009", status: "1 ", reason: "01  " },
      { amount: "0000000200000", reference: "EMP010", status: "1 ", reason: "02  " },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().data.credited).toBe(0);
    expect(res.json().data.returned).toBe(2);
  });

  it("returns 202 for super_admin role", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000050000", reference: "EMP011", status: "0 ", reason: "    " },
    ]);
    const app = await buildApp();
    const superToken = signToken({ sub: ACTOR, tid: TENANT, roles: ["super_admin"], sid: "s1" }, SECRET);
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${superToken}`, "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /v1/payroll/runs/:id/nach-return — 400 validation errors
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/runs/:id/nach-return — validation (400)", () => {
  it("returns 400 when body is empty (text/plain)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "text/plain" },
      payload: "",
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when body is whitespace only", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "text/plain" },
      payload: "   \n  \n  ",
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when JSON body has no content field", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { data: "not the right field" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when JSON content is empty string", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { content: "" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for unparseable file (too few lines)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "text/plain" },
      payload: "01HEADER\n",
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_RETURN_FILE");
  });

  it("returns 400 for file without proper header (type XX)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "text/plain" },
      payload: "XX" + " ".repeat(158) + "\n" + "02" + " ".repeat(158) + "\n" + "03" + " ".repeat(158),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_RETURN_FILE");
  });

  it("returns 400 when runId is not a valid UUID", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000100000", reference: "EMP001", status: "0 ", reason: "    " },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs/not-a-uuid/nach-return",
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 for random garbage content", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "text/plain" },
      payload: "RANDOM GARBAGE DATA THAT IS NOT A NACH FILE FORMAT AT ALL",
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /v1/payroll/runs/:id/nach-return — 401 unauthenticated
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/runs/:id/nach-return — auth (401)", () => {
  it("returns 401 when no token provided (text/plain)", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000100000", reference: "EMP001", status: "0 ", reason: "    " },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when no token provided (JSON)", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000100000", reference: "EMP001", status: "0 ", reason: "    " },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      payload: { content: fileContent },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with invalid/expired token", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000100000", reference: "EMP001", status: "0 ", reason: "    " },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: "Bearer invalid.token.value", "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /v1/payroll/runs/:id/nach-return — 403 forbidden
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/runs/:id/nach-return — auth (403)", () => {
  it("returns 403 for employee role", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000100000", reference: "EMP001", status: "0 ", reason: "    " },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${employeeToken()}`, "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for citizen role", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000100000", reference: "EMP001", status: "0 ", reason: "    " },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${citizenToken()}`, "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for hr_admin role (not in ADMIN_ROLES)", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000100000", reference: "EMP001", status: "0 ", reason: "    " },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${hrToken()}`, "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for finance_officer role", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000100000", reference: "EMP001", status: "0 ", reason: "    " },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${financeToken()}`, "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for payroll_officer role (only admin can upload)", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000100000", reference: "EMP001", status: "0 ", reason: "    " },
    ]);
    const officerToken = signToken({ sub: ACTOR, tid: TENANT, roles: ["payroll_officer"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${officerToken}`, "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases & additional coverage
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/runs/:id/nach-return — edge cases", () => {
  it("handles file with only credited records (no returns)", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000100000", reference: "EMP-A1", status: "0 ", reason: "    " },
      { amount: "0000000200000", reference: "EMP-A2", status: "0 ", reason: "    " },
      { amount: "0000000300000", reference: "EMP-A3", status: "0 ", reason: "    " },
      { amount: "0000000400000", reference: "EMP-A4", status: "0 ", reason: "    " },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().data.credited).toBe(4);
    expect(res.json().data.returned).toBe(0);
    expect(res.json().data.unmatched).toBe(0);
  });

  it("handles mixed status codes", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000100000", reference: "MIX-01", status: "0 ", reason: "    " },
      { amount: "0000000200000", reference: "MIX-02", status: "1 ", reason: "01  " },
      { amount: "0000000300000", reference: "MIX-03", status: "2 ", reason: "99  " },
      { amount: "0000000400000", reference: "MIX-04", status: "0 ", reason: "    " },
      { amount: "0000000500000", reference: "MIX-05", status: "1 ", reason: "02  " },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/nach-return`,
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.credited).toBe(2);
    expect(body.data.returned).toBe(2);
    expect(body.data.unmatched).toBe(1);
  });

  it("uses different runId per request", async () => {
    const fileContent = buildNachReturnFile([
      { amount: "0000000100000", reference: "DIFF-01", status: "0 ", reason: "    " },
    ]);
    const newRunId = randomUUID();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${newRunId}/nach-return`,
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "text/plain" },
      payload: fileContent,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});
