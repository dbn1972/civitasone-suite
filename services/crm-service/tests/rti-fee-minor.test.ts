/**
 * GAP-CRM-RTI-NEW-01 — the RTI application fee is money and must be stored as
 * bigint minor units (paise), per CLAUDE.md §3.11, not a rupees float.
 *
 * POST /v1/crm/rti now accepts feeAmountMinor (paise) and persists it to the
 * new fee_amount_minor bigint column exactly, with no float rounding. The
 * legacy rupees feeAmount is still accepted (and kept in sync) for backward
 * compatibility during the expand phase.
 *
 * Real DB round trips.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function authHeaders(roles: string[], tid: string): Record<string, string> {
  const jwt = signToken({ sub: randomUUID(), tid, roles, sid: "sess-rti-fee" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    section: "s.6",
    departmentRef: "REVENUE",
    applicantName: "Test Applicant",
    subject: "Request for property tax records",
    description: "Please furnish copies of assessment records for FY24-25.",
    ...overrides,
  };
}

describe("GAP-CRM-RTI-NEW-01: RTI fee stored as paise (bigint minor units)", () => {
  it("accepts feeAmountMinor and persists it exactly (10.10 -> 1010 paise), returned on detail", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST",
      url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload({ feePaid: true, feeAmountMinor: "1010" }),
    });
    expect(create.statusCode).toBe(201);
    const row = create.json().data;
    // Returned as the exact paise value (string or number -> normalise).
    expect(String(row.feeAmountMinor)).toBe("1010");

    const detail = await app.inject({
      method: "GET",
      url: `/v1/crm/rti/${row.id}`,
      headers: authHeaders(["crm_user"], tid),
    });
    expect(String(detail.json().data.feeAmountMinor)).toBe("1010");
  });

  it("accepts feeAmountMinor as a JSON integer too", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST",
      url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload({ feePaid: true, feeAmountMinor: 2500 }),
    });
    expect(create.statusCode).toBe(201);
    expect(String(create.json().data.feeAmountMinor)).toBe("2500");
  });

  it("keeps the legacy rupees feeAmount working and derives paise from it (10.00 -> 1000)", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST",
      url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload({ feePaid: true, feeAmount: 10 }),
    });
    expect(create.statusCode).toBe(201);
    expect(String(create.json().data.feeAmountMinor)).toBe("1000");
  });
});

describe("RTI fee bounds and agreement (review fix)", () => {
  async function post(extra: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], randomUUID()),
      payload: basePayload({ feePaid: true, ...extra }),
    });
  }

  it("rejects an out-of-range feeAmountMinor with 422 (not a 500 overflow)", async () => {
    const res = await post({ feeAmountMinor: "99999999999999999999" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("FEE_OUT_OF_RANGE");
    const res2 = await post({ feeAmountMinor: "10000000000" });
    expect(res2.statusCode).toBe(422);
  });

  it("rejects an out-of-range rupees feeAmount with 422", async () => {
    const res = await post({ feeAmount: 100000000 });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("FEE_OUT_OF_RANGE");
  });

  it("accepts the maximum representable fee", async () => {
    const res = await post({ feeAmountMinor: "9999999999" });
    expect(res.statusCode).toBe(201);
    expect(String(res.json().data.feeAmountMinor)).toBe("9999999999");
  });

  it("rejects disagreeing feeAmount and feeAmountMinor with 422", async () => {
    const res = await post({ feeAmount: 10, feeAmountMinor: "1001" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("FEE_AMOUNT_MISMATCH");
  });

  it("accepts feeAmount and feeAmountMinor that agree exactly", async () => {
    const res = await post({ feeAmount: 10.1, feeAmountMinor: "1010" });
    expect(res.statusCode).toBe(201);
    expect(String(res.json().data.feeAmountMinor)).toBe("1010");
  });
});
