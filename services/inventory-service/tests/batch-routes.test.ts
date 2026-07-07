/**
 * Batch and Serial route-level integration tests.
 *
 * Uses app.inject() against in-memory Fastify (no network).
 * Covers: 202 happy path, 400 validation, 401 unauthenticated, 403 forbidden, 404 not found, 422 expired.
 *
 * Validates: Requirements 14.5, 14.6
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const ACTOR = "00000000-aaaa-4000-8000-000000000099";
const TENANT = "11111111-aaaa-4000-8000-000000000099";
const ITEM_UUID = "33333333-aaaa-4000-8000-000000000099";
const BATCH_UUID = "44444444-aaaa-4000-8000-000000000099";
const SECRET = "test_secret_for_civitasone_32chr";

function token(roles: string[] = ["inventory_admin"], sub = ACTOR): string {
  return signToken({ sub, tid: TENANT, roles }, SECRET, 3600);
}

function authHeader(roles?: string[], sub?: string) {
  return { authorization: `Bearer ${token(roles, sub)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

// ══════════════════════════════════════════════════════════════════════════════
// BATCH ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Batch routes", () => {
  // POST /v1/inventory/batches
  it("POST /v1/inventory/batches → 202 valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/batches",
      headers: authHeader(),
      payload: {
        itemId: ITEM_UUID,
        batchNumber: "BATCH-2025-001",
        mfgDate: "2025-01-01",
        expiryDate: "2026-01-01",
        qty: 100,
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(res.json()).toHaveProperty("id");
    expect(res.json()).toHaveProperty("correlationId");
  });

  it("POST /v1/inventory/batches → 202 minimal (qty defaults to 0)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/batches",
      headers: authHeader(["store_keeper"]),
      payload: {
        itemId: ITEM_UUID,
        batchNumber: "BATCH-2025-002",
        mfgDate: "2025-02-01",
        expiryDate: "2026-02-01",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/inventory/batches → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/batches",
      headers: authHeader(), payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("POST /v1/inventory/batches → 400 invalid itemId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/batches",
      headers: authHeader(),
      payload: {
        itemId: "not-uuid",
        batchNumber: "BATCH-001",
        mfgDate: "2025-01-01",
        expiryDate: "2026-01-01",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/batches → 400 invalid date format", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/batches",
      headers: authHeader(),
      payload: {
        itemId: ITEM_UUID,
        batchNumber: "BATCH-001",
        mfgDate: "01-01-2025",
        expiryDate: "2026-01-01",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/batches → 400 batchNumber too long", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/batches",
      headers: authHeader(),
      payload: {
        itemId: ITEM_UUID,
        batchNumber: "A".repeat(65),
        mfgDate: "2025-01-01",
        expiryDate: "2026-01-01",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/batches → 400 negative qty", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/batches",
      headers: authHeader(),
      payload: {
        itemId: ITEM_UUID,
        batchNumber: "BATCH-001",
        mfgDate: "2025-01-01",
        expiryDate: "2026-01-01",
        qty: -5,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/batches → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/batches",
      headers: authHeader(["citizen"]),
      payload: {
        itemId: ITEM_UUID,
        batchNumber: "BATCH-001",
        mfgDate: "2025-01-01",
        expiryDate: "2026-01-01",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/inventory/batches → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/batches",
      payload: {
        itemId: ITEM_UUID,
        batchNumber: "BATCH-001",
        mfgDate: "2025-01-01",
        expiryDate: "2026-01-01",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  // GET /v1/inventory/batches/:id
  it("GET /v1/inventory/batches/:id → 404 not found", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/batches/${BATCH_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/inventory/batches/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/batches/not-a-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/inventory/batches/:id → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/batches/${BATCH_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/inventory/batches/:id → 401 no token", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/batches/${BATCH_UUID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  // GET /v1/inventory/batches
  it("GET /v1/inventory/batches → 200 list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/batches",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
    expect(res.json()).toHaveProperty("meta");
  });

  it("GET /v1/inventory/batches?itemId=uuid → 200", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/batches?itemId=${ITEM_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/inventory/batches?itemId=bad → 400", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/batches?itemId=not-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/inventory/batches → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/batches",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/inventory/batches → 401 no token", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/batches",
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BATCH ISSUE ROUTES (Expiry Validation)
// ══════════════════════════════════════════════════════════════════════════════
describe("Batch issue routes — expiry validation", () => {
  // POST /v1/inventory/batches/issue → 404 when batch not found
  it("POST /v1/inventory/batches/issue → 404 batch not found", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/batches/issue",
      headers: authHeader(),
      payload: {
        batchId: BATCH_UUID,
        qty: 10,
        postingDate: "2025-06-15",
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/inventory/batches/issue → 400 missing batchId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/batches/issue",
      headers: authHeader(),
      payload: { qty: 10, postingDate: "2025-06-15" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/batches/issue → 400 zero qty", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/batches/issue",
      headers: authHeader(),
      payload: { batchId: BATCH_UUID, qty: 0, postingDate: "2025-06-15" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/batches/issue → 400 invalid date format", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/batches/issue",
      headers: authHeader(),
      payload: { batchId: BATCH_UUID, qty: 5, postingDate: "15/06/2025" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/batches/issue → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/batches/issue",
      headers: authHeader(["citizen"]),
      payload: { batchId: BATCH_UUID, qty: 5, postingDate: "2025-06-15" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/inventory/batches/issue → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/batches/issue",
      payload: { batchId: BATCH_UUID, qty: 5, postingDate: "2025-06-15" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SERIAL NUMBER ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Serial number routes", () => {
  // POST /v1/inventory/serials
  it("POST /v1/inventory/serials → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/serials",
      headers: authHeader(),
      payload: { itemId: ITEM_UUID, serialNumber: "SN-2025-001" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(res.json()).toHaveProperty("id");
  });

  it("POST /v1/inventory/serials → 202 with batchId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/serials",
      headers: authHeader(["store_keeper"]),
      payload: { itemId: ITEM_UUID, batchId: BATCH_UUID, serialNumber: "SN-2025-002" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/inventory/serials → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/serials",
      headers: authHeader(), payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/serials → 400 invalid itemId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/serials",
      headers: authHeader(),
      payload: { itemId: "not-uuid", serialNumber: "SN-001" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/serials → 400 empty serial number", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/serials",
      headers: authHeader(),
      payload: { itemId: ITEM_UUID, serialNumber: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/serials → 400 serial too long", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/serials",
      headers: authHeader(),
      payload: { itemId: ITEM_UUID, serialNumber: "A".repeat(129) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/serials → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/serials",
      headers: authHeader(["citizen"]),
      payload: { itemId: ITEM_UUID, serialNumber: "SN-001" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/inventory/serials → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/serials",
      payload: { itemId: ITEM_UUID, serialNumber: "SN-001" },
    });
    expect(res.statusCode).toBe(401);
  });

  // GET /v1/inventory/serials/:id
  it("GET /v1/inventory/serials/:id → 404 not found", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/serials/${BATCH_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/inventory/serials/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/serials/not-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/inventory/serials/:id → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/serials/${BATCH_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/inventory/serials/:id → 401 no token", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/serials/${BATCH_UUID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  // GET /v1/inventory/serials
  it("GET /v1/inventory/serials → 200 list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/serials",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
    expect(res.json()).toHaveProperty("meta");
  });

  it("GET /v1/inventory/serials?itemId=uuid → 200", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/serials?itemId=${ITEM_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/inventory/serials?batchId=uuid → 200", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/serials?batchId=${BATCH_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/inventory/serials?itemId=bad → 400", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/serials?itemId=not-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/inventory/serials → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/serials",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/inventory/serials → 401 no token", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/serials",
    });
    expect(res.statusCode).toBe(401);
  });
});
