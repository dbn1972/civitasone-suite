/**
 * Quotation tests (QP-003, QP-005).
 * Covers create-from-template, versioning, the state machine (invalid → 422,
 * terminal → 422), the mandatory rejection reason, and exact bigint money
 * handling above 2^53.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import {
  canTransition,
  isTerminalStatus,
  isQuotationStatus,
  allowedNextStatuses,
  sumLineItems,
  isExpired,
  isValidRejectReason,
  requiresRejectReason,
} from "../src/modules/deals/quotation-domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000066";
const ACTOR = "cccccccc-3333-4000-8000-000000000066";
const DEAL = "22222222-6600-4000-8000-000000000001";
const NONEXIST = "ffffffff-ffff-4000-8000-000000000066";

/** 2^53 + 1 — the smallest integer a JS number cannot represent exactly. */
const ABOVE_2_53 = "9007199254740993";

let refCounter = 0;
function nextRef(prefix: string): string {
  refCounter += 1;
  return `${prefix}-${refCounter}`;
}

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-quote" }, SECRET);
}

function headers(roles = ["crm_user"]) {
  return { authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT };
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.quotations WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(cleanup);

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

async function createQuote(payload: Record<string, unknown>, roles = ["crm_user"]) {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/crm/quotations",
    headers: headers(roles),
    payload,
  });
  await app.close();
  return res;
}

async function act(id: string, action: string, payload?: Record<string, unknown>) {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: `/v1/crm/quotations/${id}/${action}`,
    headers: headers(),
    ...(payload ? { payload } : {}),
  });
  await app.close();
  return res;
}

describe("quotation-domain (pure)", () => {
  it("allows draft → sent → decided", () => {
    expect(canTransition("draft", "sent")).toBe(true);
    expect(canTransition("sent", "accepted")).toBe(true);
    expect(canTransition("sent", "rejected")).toBe(true);
    expect(canTransition("sent", "expired")).toBe(true);
  });

  it("rejects skipping and reversing", () => {
    expect(canTransition("draft", "accepted")).toBe(false);
    expect(canTransition("sent", "draft")).toBe(false);
    expect(canTransition("accepted", "rejected")).toBe(false);
  });

  it("treats accepted and rejected as terminal", () => {
    expect(isTerminalStatus("accepted")).toBe(true);
    expect(isTerminalStatus("rejected")).toBe(true);
    expect(isTerminalStatus("expired")).toBe(true);
    expect(isTerminalStatus("draft")).toBe(false);
    expect(allowedNextStatuses("accepted")).toHaveLength(0);
    expect(allowedNextStatuses("draft")).toEqual(["sent"]);
  });

  it("validates status names", () => {
    expect(isQuotationStatus("sent")).toBe(true);
    expect(isQuotationStatus("archived")).toBe(false);
  });

  it("requires a substantive rejection reason", () => {
    expect(requiresRejectReason("rejected")).toBe(true);
    expect(requiresRejectReason("accepted")).toBe(false);
    expect(isValidRejectReason("no")).toBe(false);
    expect(isValidRejectReason("Chose a lower-priced competitor")).toBe(true);
  });

  it("sums line items with BigInt, exactly, past 2^53", () => {
    const total = sumLineItems([
      { description: "Licences", quantity: 1_000_000, unitPriceMinor: "9007199254" },
      { description: "Support", quantity: 1, unitPriceMinor: "1" },
    ]);
    expect(total).toBe(9_007_199_254_000_000n + 1n);
    expect(total.toString()).toBe("9007199254000001");
  });

  it("returns 0 for no line items", () => {
    expect(sumLineItems([])).toBe(0n);
  });

  it("detects expiry against an injected now", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(isExpired(new Date("2026-05-31T23:59:00Z"), now)).toBe(true);
    expect(isExpired(new Date("2026-06-02T00:00:00Z"), now)).toBe(false);
    expect(isExpired(null, now)).toBe(false);
  });
});

describe("POST /v1/crm/quotations", () => {
  it("creates version 1 from a template and totals the lines → 201", async () => {
    const res = await createQuote({
      dealId: DEAL,
      quoteRef: "Q-2026-001",
      templateRef: "tpl-standard-v3",
      lineItems: [
        { description: "Platform licence", quantity: 10, unitPriceMinor: "500000" },
        { description: "Onboarding", quantity: 1, unitPriceMinor: "150000" },
      ],
      validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });

    expect(res.statusCode).toBe(201);
    const d = res.json().data;
    expect(d.versionNumber).toBe(1);
    expect(d.status).toBe("draft");
    expect(d.totalMinor).toBe("5150000");
    expect(typeof d.totalMinor).toBe("string");
  });

  it("round-trips a total above 2^53 exactly", async () => {
    const created = await createQuote({
      quoteRef: "Q-2026-BIG",
      templateRef: "tpl-mega",
      totalMinor: ABOVE_2_53,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.totalMinor).toBe(ABOVE_2_53);

    const app = await buildApp();
    const listed = await app.inject({
      method: "GET",
      url: "/v1/crm/quotations?limit=100",
      headers: headers(),
    });
    await app.close();

    const row = listed.json().data.find((q: { quoteRef: string }) => q.quoteRef === "Q-2026-BIG");
    expect(row.totalMinor).toBe(ABOVE_2_53);
    expect(BigInt(row.totalMinor)).toBe(BigInt(ABOVE_2_53));
    // Proof the string mattered: a float round-trip would lose the final digit.
    expect(Number(row.totalMinor).toString()).not.toBe(ABOVE_2_53);
  });

  it("rejects a duplicate quoteRef at version 1 → 409", async () => {
    const res = await createQuote({ quoteRef: "Q-2026-001", templateRef: "tpl-standard-v3" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("QUOTE_EXISTS");
  });

  it("rejects a float unit price → 400", async () => {
    const res = await createQuote({
      quoteRef: nextRef("Q-FLOAT"),
      templateRef: "tpl",
      lineItems: [{ description: "Bad", quantity: 1, unitPriceMinor: "10.55" }],
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a missing templateRef → 400", async () => {
    const res = await createQuote({ quoteRef: nextRef("Q-NOTPL") });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/quotations",
      payload: { quoteRef: "Q-401", templateRef: "tpl" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for an unrelated role", async () => {
    const res = await createQuote({ quoteRef: nextRef("Q-403"), templateRef: "tpl" }, ["citizen"]);
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/quotations", () => {
  it("returns the list envelope", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/quotations", headers: headers() });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBeGreaterThanOrEqual(2);
  });

  it("filters by dealId and status", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/quotations?dealId=${DEAL}&status=draft`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    for (const row of res.json().data) {
      expect(row.dealId).toBe(DEAL);
      expect(row.status).toBe("draft");
    }
  });

  it("rejects an unknown status filter → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/quotations?status=void",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/quotations" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/crm/quotations/:id/new-version", () => {
  it("clones and bumps the version number → 201", async () => {
    const ref = nextRef("Q-VER");
    const created = await createQuote({
      quoteRef: ref,
      templateRef: "tpl-standard-v3",
      lineItems: [{ description: "Licence", quantity: 2, unitPriceMinor: "100000" }],
    });
    const id = created.json().data.id;

    const v2 = await act(id, "new-version", {
      lineItems: [{ description: "Licence", quantity: 3, unitPriceMinor: "100000" }],
    });

    expect(v2.statusCode).toBe(201);
    expect(v2.json().data.versionNumber).toBe(2);
    expect(v2.json().data.status).toBe("draft");
    expect(v2.json().data.totalMinor).toBe("300000");
    expect(v2.json().data.clonedFrom).toBe(id);

    // A third revision must land on 3, not overwrite 2.
    const v3 = await act(v2.json().data.id, "new-version", {});
    expect(v3.statusCode).toBe(201);
    expect(v3.json().data.versionNumber).toBe(3);
    expect(v3.json().data.totalMinor).toBe("300000");
  });

  it("can revise an accepted quote (a revision is a new offer)", async () => {
    const ref = nextRef("Q-REVACC");
    const created = await createQuote({ quoteRef: ref, templateRef: "tpl", totalMinor: "1000" });
    const id = created.json().data.id;
    await act(id, "send");
    await act(id, "accept");

    const revised = await act(id, "new-version", { totalMinor: "2000" });
    expect(revised.statusCode).toBe(201);
    expect(revised.json().data.status).toBe("draft");
    expect(revised.json().data.totalMinor).toBe("2000");
  });

  it("returns 404 for an unknown quotation", async () => {
    const res = await act(NONEXIST, "new-version", {});
    expect(res.statusCode).toBe(404);
  });

  it("rejects a float total → 400", async () => {
    const created = await createQuote({ quoteRef: nextRef("Q-VERFLOAT"), templateRef: "tpl" });
    const res = await act(created.json().data.id, "new-version", { totalMinor: "12.34" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/quotations/${NONEXIST}/new-version`,
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("quotation lifecycle", () => {
  it("sends then accepts → 200 each, money preserved", async () => {
    const created = await createQuote({
      quoteRef: nextRef("Q-LIFE"),
      templateRef: "tpl",
      totalMinor: ABOVE_2_53,
    });
    const id = created.json().data.id;

    const sent = await act(id, "send");
    expect(sent.statusCode).toBe(200);
    expect(sent.json().data.status).toBe("sent");

    const accepted = await act(id, "accept");
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().data.status).toBe("accepted");
    expect(accepted.json().data.totalMinor).toBe(ABOVE_2_53);
  });

  it("rejects with a reason → 200", async () => {
    const created = await createQuote({ quoteRef: nextRef("Q-REJ"), templateRef: "tpl" });
    const id = created.json().data.id;
    await act(id, "send");

    const rejected = await act(id, "reject", { reason: "Chose a lower-priced competitor" });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().data.status).toBe("rejected");
  });

  it("requires a 10+ char rejection reason → 400", async () => {
    const created = await createQuote({ quoteRef: nextRef("Q-REJSHORT"), templateRef: "tpl" });
    const id = created.json().data.id;
    await act(id, "send");

    const short = await act(id, "reject", { reason: "nope" });
    expect(short.statusCode).toBe(400);
    expect(short.json().code).toBe("REASON_REQUIRED");

    const missing = await act(id, "reject", {});
    expect(missing.statusCode).toBe(400);
  });

  it("refuses to accept a draft (skipped state) → 422", async () => {
    const created = await createQuote({ quoteRef: nextRef("Q-SKIP"), templateRef: "tpl" });
    const res = await act(created.json().data.id, "accept");
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_TRANSITION");
  });

  it("refuses to send twice → 422", async () => {
    const created = await createQuote({ quoteRef: nextRef("Q-TWICE"), templateRef: "tpl" });
    const id = created.json().data.id;
    await act(id, "send");
    const again = await act(id, "send");
    expect(again.statusCode).toBe(422);
  });

  it("refuses any transition out of accepted (terminal) → 422", async () => {
    const created = await createQuote({ quoteRef: nextRef("Q-TERM"), templateRef: "tpl" });
    const id = created.json().data.id;
    await act(id, "send");
    await act(id, "accept");

    const rejectAfter = await act(id, "reject", { reason: "Changed our mind after acceptance" });
    expect(rejectAfter.statusCode).toBe(422);
    expect(rejectAfter.json().message).toContain("terminal");
  });

  it("refuses any transition out of rejected (terminal) → 422", async () => {
    const created = await createQuote({ quoteRef: nextRef("Q-TERM2"), templateRef: "tpl" });
    const id = created.json().data.id;
    await act(id, "send");
    await act(id, "reject", { reason: "Budget was withdrawn entirely" });

    const acceptAfter = await act(id, "accept");
    expect(acceptAfter.statusCode).toBe(422);
  });

  it("returns 404 for unknown ids on every action", async () => {
    expect((await act(NONEXIST, "send")).statusCode).toBe(404);
    expect((await act(NONEXIST, "accept")).statusCode).toBe(404);
    expect((await act(NONEXIST, "reject", { reason: "Ghost quote rejection" })).statusCode).toBe(404);
  });

  it("returns 400 for a non-uuid id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/quotations/not-a-uuid/send",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 and 403 on the action endpoints", async () => {
    const app = await buildApp();
    const unauth = await app.inject({ method: "POST", url: `/v1/crm/quotations/${NONEXIST}/send` });
    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/crm/quotations/${NONEXIST}/send`,
      headers: headers(["citizen"]),
    });
    await app.close();

    expect(unauth.statusCode).toBe(401);
    expect(forbidden.statusCode).toBe(403);
  });
});
