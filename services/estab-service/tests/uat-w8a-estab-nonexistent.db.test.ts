/**
 * UAT W8-A (estab-service, live API sweep).
 *
 * P1 accept-nonexistent: 26 command routes published a command for any well-formed :id, so a
 * random id got 202 and the consumer dropped it. Each now does a tenant-scoped existence read
 * (inside the request tenant context, RLS-safe) and answers 404 without publishing.
 *
 * 5xx: seven GET-by-id routes passed a malformed id straight to a uuid column and 500ed on the
 * cast (Postgres 22P02, confirmed in the live estab log). The id is validated first: 400.
 *
 * Real DB (estab_svc under FORCE RLS).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { estabFiles, estabNotings } from "../src/modules/files/schema.js";
import { estabDfa } from "../src/modules/dfa/schema.js";
import { estabFacilitiesCatalog, estabBookings } from "../src/modules/booking/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const DRAFTER = randomUUID();
const FILE = randomUUID();
const NOTING = randomUUID();
const DFA = randomUUID();
const FACILITY = randomUUID();
const BOOKING = randomUUID();

const hdr = (roles: string[] = ["super_admin"], tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s-w8a" }, SECRET, 3600)}`,
  // The gateway forwards the tenant; createTenantTxHook sets the RLS GUC from it.
  "x-tenant-id": tenant,
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(estabFiles).values({
      id: FILE, tenantId: TENANT, fileNo: `W8A/${FILE.slice(0, 8)}`, subject: "w8a file", dept: "estab",
      currentWith: ACTOR, createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(estabNotings).values({
      id: NOTING, tenantId: TENANT, fileId: FILE, seq: 1, officerId: ACTOR, body: "w8a noting",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(estabDfa).values({
      id: DFA, tenantId: TENANT, dfaNo: `W8A/DFA/${DFA.slice(0, 8)}`, subject: "w8a dfa", body: "body",
      createdBy: DRAFTER, updatedBy: DRAFTER,
    });
    await tx.insert(estabFacilitiesCatalog).values({
      id: FACILITY, tenantId: TENANT, facilityName: "w8a hall", facilityType: "community_hall",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(estabBookings).values({
      id: BOOKING, tenantId: TENANT, bookingNumber: `W8A/${BOOKING.slice(0, 8)}`, facilityId: FACILITY,
      applicantName: "w8a", applicantPhone: "9999999999", eventDate: "2026-12-01", startTime: "10:00", endTime: "12:00",
      createdBy: DRAFTER, updatedBy: DRAFTER,
    });
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(estabBookings).where(eq(estabBookings.id, BOOKING));
    await tx.delete(estabFacilitiesCatalog).where(eq(estabFacilitiesCatalog.id, FACILITY));
    await tx.delete(estabDfa).where(eq(estabDfa.id, DFA));
    await tx.delete(estabNotings).where(eq(estabNotings.id, NOTING));
    await tx.delete(estabFiles).where(eq(estabFiles.id, FILE));
  })).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

async function inject(method: "POST" | "PATCH" | "GET", url: string, headers = hdr(), payload?: object) {
  return app.inject({ method, url, headers, ...(payload !== undefined ? { payload } : {}) });
}

/** Each P1 row of the sweep: method + path template (`:id` is replaced by a random uuid). */
const P1: Array<["POST" | "PATCH", string]> = [
  ["POST",  "/v1/estab/files/:id/volumes"],
  ["POST",  "/v1/estab/files/:id/parts"],
  ["POST",  `/v1/estab/files/:id/notings/${NOTING}/sign`],
  ["PATCH", "/v1/estab/files/:id/close"],
  ["PATCH", "/v1/estab/files/:id/recall"],
  ["PATCH", "/v1/estab/vehicle-bookings/:id/return"],
  ["PATCH", "/v1/estab/room-bookings/:id/checkin"],
  ["PATCH", "/v1/estab/room-bookings/:id/checkout"],
  ["PATCH", "/v1/estab/approval-rules/:id"],
  ["PATCH", "/v1/estab/dfa/:id"],
  ["POST",  "/v1/estab/dfa/:id/submit"],
  ["POST",  "/v1/estab/dfa/:id/approve"],
  ["POST",  "/v1/estab/dfa/:id/sign"],
  ["POST",  "/v1/estab/dfa/:id/dispatch"],
  ["PATCH", "/v1/estab/operators/:id"],
  ["POST",  "/v1/estab/weedout/:id/approve"],
  ["POST",  "/v1/estab/weedout/:id/reject"],
  ["POST",  "/v1/estab/files/:id/transfer-to-record-room"],
  ["POST",  "/v1/estab/files/:id/archive"],
  ["PATCH", "/v1/estab/booking/facilities/:id"],
  ["POST",  "/v1/estab/booking/bookings/:id/submit"],
  ["POST",  "/v1/estab/booking/bookings/:id/approve"],
  ["POST",  "/v1/estab/booking/bookings/:id/pay"],
  ["POST",  "/v1/estab/booking/bookings/:id/cancel"],
  ["POST",  "/v1/estab/booking/bookings/:id/complete"],
  ["POST",  "/v1/estab/citizen-lease/requests/:id/complete"],
];

describe("UAT W8-A P1: commands on a non-existent :id answer 404 and publish nothing (real DB)", () => {
  for (const [method, path] of P1) {
    it(`${method} ${path}: random id -> 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        const res = await inject(method, path.replace(":id", randomUUID()), hdr(), {});
        expect(res.statusCode).toBe(404);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  }

  it("sign: an unknown noting on a real file -> 404", async () => {
    const res = await inject("POST", `/v1/estab/files/${FILE}/notings/${randomUUID()}/sign`, hdr(), {});
    expect(res.statusCode).toBe(404);
  });

  it("another tenant's file / DFA / booking -> 404, nothing published", async () => {
    const spy = vi.spyOn(queue, "publish");
    try {
      const other = hdr(["super_admin"], OTHER_TENANT);
      expect((await inject("PATCH", `/v1/estab/files/${FILE}/close`, other, {})).statusCode).toBe(404);
      expect((await inject("POST", `/v1/estab/dfa/${DFA}/submit`, other, {})).statusCode).toBe(404);
      expect((await inject("POST", `/v1/estab/booking/bookings/${BOOKING}/approve`, other, {})).statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("real records still get 202 and the command is published for this tenant", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    try {
      expect((await inject("PATCH", `/v1/estab/files/${FILE}/close`, hdr(), {})).statusCode).toBe(202);
      expect((await inject("POST", `/v1/estab/files/${FILE}/notings/${NOTING}/sign`, hdr(), {})).statusCode).toBe(202);
      expect((await inject("POST", `/v1/estab/dfa/${DFA}/submit`, hdr(), {})).statusCode).toBe(202);
      expect((await inject("PATCH", `/v1/estab/booking/facilities/${FACILITY}`, hdr(), { capacity: 50 })).statusCode).toBe(202);
      expect((await inject("POST", `/v1/estab/booking/bookings/${BOOKING}/approve`, hdr(), {})).statusCode).toBe(202);
      // A finance officer is not a booking admin; the pay pre-check stays tenant-wide, not owner-scoped.
      expect((await inject("POST", `/v1/estab/booking/bookings/${BOOKING}/pay`, hdr(["finance_officer"]), {})).statusCode).toBe(202);
      expect(spy).toHaveBeenCalled();
      for (const call of spy.mock.calls) expect(call[1]).toMatchObject({ tenantId: TENANT });
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * UAT W8-A follow-up: sibling commands with the same accept-nonexistent defect (reproduced on live
 * UAT as 202 for a random id). Bodies are valid, so the 404 comes from the existence read.
 */
const SIBLINGS: Array<["POST" | "PATCH", string, object]> = [
  ["POST",  "/v1/estab/files/:id/links", { targetFileId: FILE }],
  ["PATCH", "/v1/estab/files/:id/type", { fileType: "standing_guard" }],
  ["PATCH", "/v1/estab/files/:id/reopen", { reason: "w8a probe" }],
  ["POST",  "/v1/estab/files/:id/attach-receipt", { inwardId: randomUUID() }],
  ["POST",  "/v1/estab/files/:id/attachments", { fileName: "w8a.pdf" }],
  ["POST",  "/v1/estab/dfa/:id/return", { reason: "w8a probe" }],
  ["POST",  "/v1/estab/weedout/:id/destroy", { destructionCertRef: "W8A-PROBE" }],
  ["POST",  "/v1/estab/citizen-lease/requests/:id/review", { decision: "approved" }],
];

describe("UAT W8-A follow-up: sibling commands on a non-existent :id answer 404 and publish nothing (real DB)", () => {
  for (const [method, path, body] of SIBLINGS) {
    it(`${method} ${path}: random id -> 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        const res = await inject(method, path.replace(":id", randomUUID()), hdr(), body);
        expect(res.statusCode).toBe(404);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  }

  it("links: a real file to an unknown target -> 404 TARGET_FILE_NOT_FOUND, nothing published", async () => {
    const spy = vi.spyOn(queue, "publish");
    try {
      const res = await inject("POST", `/v1/estab/files/${FILE}/links`, hdr(), { targetFileId: randomUUID() });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("TARGET_FILE_NOT_FOUND");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("attach-receipt: a real file with an unknown DAK entry -> 404 INWARD_NOT_FOUND, nothing published", async () => {
    const spy = vi.spyOn(queue, "publish");
    try {
      const res = await inject("POST", `/v1/estab/files/${FILE}/attach-receipt`, hdr(), { inwardId: randomUUID() });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("INWARD_NOT_FOUND");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("another tenant's file / DFA -> 404 on the sibling commands", async () => {
    const other = hdr(["super_admin"], OTHER_TENANT);
    expect((await inject("PATCH", `/v1/estab/files/${FILE}/type`, other, { fileType: "standing_guard" })).statusCode).toBe(404);
    expect((await inject("POST", `/v1/estab/dfa/${DFA}/return`, other, { reason: "w8a probe" })).statusCode).toBe(404);
  });

  it("real records still get 202 on the sibling commands", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    try {
      expect((await inject("PATCH", `/v1/estab/files/${FILE}/type`, hdr(), { fileType: "standing_guard" })).statusCode).toBe(202);
      expect((await inject("POST", `/v1/estab/files/${FILE}/attachments`, hdr(), { fileName: "w8a.pdf" })).statusCode).toBe(202);
      expect((await inject("POST", `/v1/estab/dfa/${DFA}/return`, hdr(), { reason: "w8a probe" })).statusCode).toBe(202);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  // Not changed by this PR: these already read the record tenant-scoped in the command and 404 before
  // publishing (live UAT answered 404 for a random id). Pinned so they stay that way.
  const LIBRARY: Array<[string, object]> = [
    ["/v1/estab/library/books/:id", { title: "w8a probe" }],
    ["/v1/estab/library/books/:id/withdraw", { reason: "w8a probe" }],
    ["/v1/estab/library/issues/:id/return", {}],
    ["/v1/estab/library/issues/:id/renew", { dueAt: "2027-01-01T00:00:00Z" }],
  ];
  for (const [path, body] of LIBRARY) {
    it(`PATCH ${path}: random id -> 404 (already the case)`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        expect((await inject("PATCH", path.replace(":id", randomUUID()), hdr(), body)).statusCode).toBe(404);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  }
});

const GET_BY_ID = [
  "/v1/estab/approval-rules/:id",
  "/v1/estab/dfa/:id",
  "/v1/estab/dfa/:id/versions",
  "/v1/estab/files/:id/decision-log",
  "/v1/estab/operators/:id",
  "/v1/estab/files/:id/references",
  "/v1/estab/notings/:id/references",
];

describe("UAT W8-A 5xx: GET by a malformed id is a 400, not a 500 (real DB)", () => {
  for (const path of GET_BY_ID) {
    it(`${path}: malformed id -> 400`, async () => {
      const res = await inject("GET", path.replace(":id", "not-a-uuid"));
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
    it(`${path}: well-formed unknown id -> not a 5xx (404, or 200 with an empty list)`, async () => {
      const res = await inject("GET", path.replace(":id", randomUUID()));
      expect([200, 404]).toContain(res.statusCode);
    });
  }
});
