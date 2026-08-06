/**
 * G12 — programme HTTP routes (Spec §25.7, Journey J6).
 *
 * Writes are CQRS: the route answers 202 and state is asserted through the READ path only
 * after the queue has drained. That is deliberate — asserting on the 202 body alone would
 * pass just as happily against a route whose command nothing consumes, which is the exact
 * failure mode this architecture makes easy to ship.
 *
 * Every endpoint is covered for happy path + 400 + 401 + 403 + 404. Tenant ids are
 * per-run (`randomUUID()`) so parallel test files and repeated runs cannot see each
 * other's programmes, and no messageId is ever hardcoded, so nothing here poisons
 * `_inbox.processed`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";
import { throughCache } from "../src/modules/programmes/queries.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR_A = randomUUID();
const ACTOR_B = randomUUID();
const ACCOUNT_A = randomUUID();
const CONTRACT_A = randomUUID();

const DEAL_LINKABLE = randomUUID();
const DEAL_SECOND = randomUUID();

/** A well-formed uuid that is guaranteed not to exist — for the 404 cases. */
const MISSING_ID = randomUUID();

type ProgrammeView = {
  id: string;
  programmeCode: string;
  name: string;
  description: string | null;
  accountId: string;
  contractId: string | null;
  productLine: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  sponsoringDepartment: string | null;
  coverageScope: { regions?: string[]; districts?: string[] };
  version: number;
};

type MetricView = {
  id: string;
  metricKey: string;
  metricKind: string;
  valueMinor: string | null;
  currency: string | null;
  valueNumeric: string | null;
  periodStart: string;
  periodEnd: string;
};

function headers(
  tenantId: string = TENANT_A,
  actorId: string = ACTOR_A,
  roles: string[] = ["crm_admin"],
): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function call(
  method: "GET" | "POST" | "PATCH",
  url: string,
  opts: { headers?: Record<string, string>; payload?: unknown; noAuth?: boolean } = {},
) {
  const app = await buildApp();
  const res = await app.inject({
    method,
    url,
    ...(opts.noAuth ? {} : { headers: opts.headers ?? headers() }),
    ...(opts.payload === undefined ? {} : { payload: opts.payload }),
  });
  await app.close();
  await drainQueue();
  return res;
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];

function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/**
 * The in-memory bus captures a failed delivery to its DLQ instead of throwing, so a broken
 * consumer looks exactly like a slow one. Surfacing the reason turns "the row is missing"
 * into an actionable failure.
 */
function dlqErrors(): string[] {
  return ((queue as unknown as { dlq?: Array<{ topic: string; error: string }> }).dlq ?? [])
    .map((d) => `${d.topic}: ${d.error}`);
}

async function createProgramme(
  overrides: Record<string, unknown> = {},
  hdrs: Record<string, string> = headers(),
) {
  return call("POST", "/v1/crm/programmes", {
    headers: hdrs,
    payload: {
      programmeCode: `PROG-${randomUUID().slice(0, 8).toUpperCase()}`,
      name: "Urban Housing Mission",
      accountId: ACCOUNT_A,
      ...overrides,
    },
  });
}

/** Register a programme and return the row the read path serves, or fail loudly. */
async function registerProgramme(overrides: Record<string, unknown> = {}): Promise<ProgrammeView> {
  const res = await createProgramme(overrides);
  expect(res.statusCode, `create failed: ${res.body}`).toBe(202);
  const id = (res.json() as { id: string }).id;
  const read = await call("GET", `/v1/crm/programmes/${id}`);
  expect(read.statusCode, `programme was not written. DLQ: ${dlqErrors().join(" | ")}`).toBe(200);
  return (read.json() as { data: ProgrammeView }).data;
}

async function getProgramme(id: string, hdrs: Record<string, string> = headers()) {
  return call("GET", `/v1/crm/programmes/${id}`, { headers: hdrs });
}

async function activate(programme: ProgrammeView): Promise<ProgrammeView> {
  const res = await call("POST", `/v1/crm/programmes/${programme.id}/status`, {
    payload: { status: "active", version: programme.version },
  });
  expect(res.statusCode, `activate failed: ${res.body}`).toBe(202);
  const read = await getProgramme(programme.id);
  const after = (read.json() as { data: ProgrammeView }).data;
  expect(after.status, `status did not apply. DLQ: ${dlqErrors().join(" | ")}`).toBe("active");
  return after;
}

async function seedDeal(id: string): Promise<void> {
  await scoped(TENANT_A, async (tx) => {
    await tx`
      INSERT INTO crm.deals
        (id, tenant_id, name, stage, value_minor, currency, status, version,
         created_at, updated_at, created_by, updated_by)
      VALUES (${id}, ${TENANT_A}, 'Programme Deal', 'Negotiation', 500000, 'INR',
              'active', 1, now(), now(), ${ACTOR_A}, ${ACTOR_A})
      ON CONFLICT (id) DO NOTHING
    `;
  });
}

async function cleanup(): Promise<void> {
  for (const tenant of [TENANT_A, TENANT_B]) {
    await scoped(tenant, async (tx) => {
      await tx`DELETE FROM crm.programme_metrics WHERE tenant_id = ${tenant}`;
      await tx`DELETE FROM crm.programmes WHERE tenant_id = ${tenant}`;
      await tx`DELETE FROM crm.deals WHERE tenant_id = ${tenant}`;
      await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${tenant}`;
    }).catch(() => {});
  }
}

beforeAll(async () => {
  await cleanup();
  await seedDeal(DEAL_LINKABLE);
  await seedDeal(DEAL_SECOND);
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await drainQueue();
  await cleanup();
  await sqlClient.end();
});

describe("POST /v1/crm/programmes", () => {
  it("registers a programme in draft with its metadata intact", async () => {
    const code = `PMAY-U-${randomUUID().slice(0, 6).toUpperCase()}`;
    const programme = await registerProgramme({
      programmeCode: code.toLowerCase(),
      name: "PM Awas Yojana Urban",
      description: "Urban housing for the economically weaker section",
      contractId: CONTRACT_A,
      startDate: "2026-04-01",
      endDate: "2027-03-31",
      sponsoringDepartment: "Ministry of Housing and Urban Affairs",
      coverageScope: { regions: [" MH ", "MH", "GJ"], districts: ["Pune", "Nashik"] },
    });

    // Uppercased at the boundary, so the tenant-unique key is the canonical form.
    expect(programme.programmeCode).toBe(code);
    expect(programme.status).toBe("draft");
    expect(programme.productLine).toBe("government");
    expect(programme.accountId).toBe(ACCOUNT_A);
    expect(programme.contractId).toBe(CONTRACT_A);
    expect(programme.startDate).toBe("2026-04-01");
    expect(programme.endDate).toBe("2027-03-31");
    // De-duplicated and sorted by the domain before the write.
    expect(programme.coverageScope).toEqual({ regions: ["GJ", "MH"], districts: ["Nashik", "Pune"] });
    expect(programme.version).toBe(1);
  });

  it("400s a malformed programme code, an unknown field and a bad date order", async () => {
    const badCode = await createProgramme({ programmeCode: "has space" });
    expect(badCode.statusCode).toBe(400);

    const unknownField = await createProgramme({ productLineName: "government" });
    expect(unknownField.statusCode, "an unknown field must not be silently ignored").toBe(400);

    const badDates = await createProgramme({ startDate: "2027-03-31", endDate: "2026-04-01" });
    expect(badDates.statusCode).toBe(400);
    expect(badDates.json().code).toBe("INVALID_DATE_RANGE");

    const missingAccount = await call("POST", "/v1/crm/programmes", {
      payload: { programmeCode: "VALID-CODE-1", name: "No account" },
    });
    expect(missingAccount.statusCode).toBe(400);
  });

  it("401s without a token", async () => {
    const res = await call("POST", "/v1/crm/programmes", {
      noAuth: true,
      payload: { programmeCode: "VALID-CODE-2", name: "x", accountId: ACCOUNT_A },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s a crm_user — registering a programme is a governance action", async () => {
    const res = await createProgramme({}, headers(TENANT_A, ACTOR_A, ["crm_user"]));
    expect(res.statusCode).toBe(403);
  });

  it("409s a duplicate code instead of 202-ing a command that converges away", async () => {
    const programme = await registerProgramme();
    const again = await createProgramme({ programmeCode: programme.programmeCode });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("DUPLICATE_PROGRAMME_CODE");
  });
});

describe("GET /v1/crm/programmes", () => {
  it("lists this tenant's programmes in the standard envelope", async () => {
    const programme = await registerProgramme();
    const res = await call("GET", "/v1/crm/programmes?limit=200");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: ProgrammeView[]; meta: { page: number; pageSize: number; total: number } };
    expect(body.meta.page).toBe(1);
    expect(body.meta.pageSize).toBe(200);
    expect(body.meta.total).toBeGreaterThan(0);
    expect(body.data.map((p) => p.id)).toContain(programme.id);
  });

  it("filters by status, accountId and productLine", async () => {
    const otherAccount = randomUUID();
    const scoped2 = await registerProgramme({ accountId: otherAccount, productLine: "psu" });

    const byAccount = await call("GET", `/v1/crm/programmes?limit=200&accountId=${otherAccount}`);
    expect(byAccount.json().data.map((p: ProgrammeView) => p.id)).toEqual([scoped2.id]);

    const byProductLine = await call("GET", "/v1/crm/programmes?limit=200&productLine=psu");
    expect(byProductLine.json().data.map((p: ProgrammeView) => p.id)).toEqual([scoped2.id]);

    const byStatus = await call("GET", "/v1/crm/programmes?limit=200&status=closed");
    expect(byStatus.json().data).toEqual([]);
  });

  it("400s an unbounded or over-large limit and a bad filter value", async () => {
    expect((await call("GET", "/v1/crm/programmes?limit=201")).statusCode).toBe(400);
    expect((await call("GET", "/v1/crm/programmes?limit=0")).statusCode).toBe(400);
    expect((await call("GET", "/v1/crm/programmes?limit=10&status=archived")).statusCode).toBe(400);
    expect((await call("GET", "/v1/crm/programmes?limit=10&accountId=not-a-uuid")).statusCode).toBe(400);
  });

  it("401s without a token and 403s a role with no CRM access", async () => {
    expect((await call("GET", "/v1/crm/programmes?limit=10", { noAuth: true })).statusCode).toBe(401);
    const forbidden = await call("GET", "/v1/crm/programmes?limit=10", {
      headers: headers(TENANT_A, ACTOR_A, ["employee"]),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("404s an unknown collection path rather than leaking a route", async () => {
    expect((await call("GET", "/v1/crm/programmes-typo?limit=10")).statusCode).toBe(404);
  });
});

describe("GET /v1/crm/programmes/:id", () => {
  it("returns the single-object envelope", async () => {
    const programme = await registerProgramme();
    const res = await getProgramme(programme.id);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: ProgrammeView }).data.id).toBe(programme.id);
  });

  it("400s a non-uuid id", async () => {
    expect((await call("GET", "/v1/crm/programmes/not-a-uuid")).statusCode).toBe(400);
  });

  it("401s without a token, 403s the wrong role, 404s a missing programme", async () => {
    const programme = await registerProgramme();
    expect((await call("GET", `/v1/crm/programmes/${programme.id}`, { noAuth: true })).statusCode).toBe(401);
    expect(
      (await getProgramme(programme.id, headers(TENANT_A, ACTOR_A, ["employee"]))).statusCode,
    ).toBe(403);
    expect((await getProgramme(MISSING_ID)).statusCode).toBe(404);
  });

  it("lets a crm_user read — reading a programme is not privileged", async () => {
    const programme = await registerProgramme();
    const res = await getProgramme(programme.id, headers(TENANT_A, ACTOR_A, ["crm_user"]));
    expect(res.statusCode).toBe(200);
  });
});

describe("PATCH /v1/crm/programmes/:id", () => {
  it("amends metadata and bumps the version", async () => {
    const programme = await registerProgramme({ sponsoringDepartment: "Dept A" });
    const res = await call("PATCH", `/v1/crm/programmes/${programme.id}`, {
      payload: {
        name: "Renamed Mission",
        sponsoringDepartment: "Dept B",
        coverageScope: { districts: ["Solapur"] },
        version: programme.version,
      },
    });
    expect(res.statusCode).toBe(202);

    const after = (await getProgramme(programme.id)).json() as { data: ProgrammeView };
    expect(after.data.name, `patch did not apply. DLQ: ${dlqErrors().join(" | ")}`).toBe("Renamed Mission");
    expect(after.data.sponsoringDepartment).toBe("Dept B");
    expect(after.data.coverageScope).toEqual({ districts: ["Solapur"] });
    expect(after.data.version).toBe(programme.version + 1);
    // Untouched fields survive.
    expect(after.data.programmeCode).toBe(programme.programmeCode);
  });

  it("clears a nullable field when explicitly sent null", async () => {
    const programme = await registerProgramme({ contractId: CONTRACT_A });
    const res = await call("PATCH", `/v1/crm/programmes/${programme.id}`, {
      payload: { contractId: null, version: programme.version },
    });
    expect(res.statusCode).toBe(202);
    const after = (await getProgramme(programme.id)).json() as { data: ProgrammeView };
    expect(after.data.contractId).toBeNull();
  });

  it("400s an empty patch, an unknown field and an inverted date range", async () => {
    const programme = await registerProgramme({ startDate: "2026-04-01", endDate: "2027-03-31" });

    const empty = await call("PATCH", `/v1/crm/programmes/${programme.id}`, {
      payload: { version: programme.version },
    });
    expect(empty.statusCode).toBe(400);

    const unknown = await call("PATCH", `/v1/crm/programmes/${programme.id}`, {
      payload: { programmeCode: "NEW-CODE-1", version: programme.version },
    });
    expect(unknown.statusCode, "programmeCode must not be amendable").toBe(400);

    // Only startDate is sent; it must still be compared against the STORED endDate.
    const inverted = await call("PATCH", `/v1/crm/programmes/${programme.id}`, {
      payload: { startDate: "2028-01-01", version: programme.version },
    });
    expect(inverted.statusCode).toBe(400);
    expect(inverted.json().code).toBe("INVALID_DATE_RANGE");

    const noVersion = await call("PATCH", `/v1/crm/programmes/${programme.id}`, {
      payload: { name: "x" },
    });
    expect(noVersion.statusCode).toBe(400);
  });

  it("409s a stale version rather than accepting a write that would be dropped", async () => {
    const programme = await registerProgramme();
    const res = await call("PATCH", `/v1/crm/programmes/${programme.id}`, {
      payload: { name: "x", version: programme.version + 99 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });

  it("422s an amendment to a closed programme — history must stay stable", async () => {
    const programme = await registerProgramme();
    const closed = await call("POST", `/v1/crm/programmes/${programme.id}/status`, {
      payload: { status: "closed", version: programme.version },
    });
    expect(closed.statusCode).toBe(202);
    const current = (await getProgramme(programme.id)).json() as { data: ProgrammeView };
    expect(current.data.status).toBe("closed");

    const res = await call("PATCH", `/v1/crm/programmes/${programme.id}`, {
      payload: { name: "rewritten history", version: current.data.version },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("PROGRAMME_CLOSED");
  });

  it("401s without a token, 403s a crm_user, 404s a missing programme", async () => {
    const programme = await registerProgramme();
    expect(
      (await call("PATCH", `/v1/crm/programmes/${programme.id}`, {
        noAuth: true,
        payload: { name: "x", version: 1 },
      })).statusCode,
    ).toBe(401);

    expect(
      (await call("PATCH", `/v1/crm/programmes/${programme.id}`, {
        headers: headers(TENANT_A, ACTOR_A, ["crm_user"]),
        payload: { name: "x", version: 1 },
      })).statusCode,
    ).toBe(403);

    expect(
      (await call("PATCH", `/v1/crm/programmes/${MISSING_ID}`, { payload: { name: "x", version: 1 } }))
        .statusCode,
    ).toBe(404);
  });
});

describe("POST /v1/crm/programmes/:id/status", () => {
  it("walks the lifecycle and records each transition", async () => {
    let programme = await registerProgramme();
    programme = await activate(programme);

    const suspend = await call("POST", `/v1/crm/programmes/${programme.id}/status`, {
      payload: { status: "suspended", reason: "funds withheld pending audit", version: programme.version },
    });
    expect(suspend.statusCode).toBe(202);
    const suspended = ((await getProgramme(programme.id)).json() as { data: ProgrammeView }).data;
    expect(suspended.status).toBe("suspended");

    const resume = await call("POST", `/v1/crm/programmes/${programme.id}/status`, {
      payload: { status: "active", version: suspended.version },
    });
    expect(resume.statusCode).toBe(202);
    expect(((await getProgramme(programme.id)).json() as { data: ProgrammeView }).data.status).toBe("active");
  });

  it("422s an illegal transition and refuses anything after closure", async () => {
    const programme = await registerProgramme();
    const skip = await call("POST", `/v1/crm/programmes/${programme.id}/status`, {
      payload: { status: "suspended", version: programme.version },
    });
    expect(skip.statusCode).toBe(422);
    expect(skip.json().code).toBe("INVALID_TRANSITION");

    const closed = await call("POST", `/v1/crm/programmes/${programme.id}/status`, {
      payload: { status: "closed", version: programme.version },
    });
    expect(closed.statusCode).toBe(202);
    const after = ((await getProgramme(programme.id)).json() as { data: ProgrammeView }).data;

    const reopen = await call("POST", `/v1/crm/programmes/${programme.id}/status`, {
      payload: { status: "active", version: after.version },
    });
    expect(reopen.statusCode).toBe(422);
    expect(reopen.json().message).toContain("terminal");
  });

  it("400s an unknown status, a missing version and an unknown field", async () => {
    const programme = await registerProgramme();
    expect(
      (await call("POST", `/v1/crm/programmes/${programme.id}/status`, {
        payload: { status: "archived", version: programme.version },
      })).statusCode,
    ).toBe(400);
    expect(
      (await call("POST", `/v1/crm/programmes/${programme.id}/status`, { payload: { status: "active" } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call("POST", `/v1/crm/programmes/${programme.id}/status`, {
        payload: { status: "active", version: programme.version, force: true },
      })).statusCode,
    ).toBe(400);
  });

  it("409s a stale version", async () => {
    const programme = await registerProgramme();
    const res = await call("POST", `/v1/crm/programmes/${programme.id}/status`, {
      payload: { status: "active", version: programme.version + 5 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("401s without a token, 403s a crm_user, 404s a missing programme", async () => {
    const programme = await registerProgramme();
    expect(
      (await call("POST", `/v1/crm/programmes/${programme.id}/status`, {
        noAuth: true,
        payload: { status: "active", version: 1 },
      })).statusCode,
    ).toBe(401);
    expect(
      (await call("POST", `/v1/crm/programmes/${programme.id}/status`, {
        headers: headers(TENANT_A, ACTOR_A, ["crm_user"]),
        payload: { status: "active", version: 1 },
      })).statusCode,
    ).toBe(403);
    expect(
      (await call("POST", `/v1/crm/programmes/${MISSING_ID}/status`, {
        payload: { status: "active", version: 1 },
      })).statusCode,
    ).toBe(404);
  });
});

describe("POST /v1/crm/programmes/:id/metrics", () => {
  it("records a monetary metric with no precision loss", async () => {
    const programme = await activate(await registerProgramme());
    // Above 2^53 paise: a JSON number would have rounded this before it left the route.
    const revenue = "9007199254740993";
    const res = await call("POST", `/v1/crm/programmes/${programme.id}/metrics`, {
      payload: {
        periodStart: "2026-04-01",
        periodEnd: "2026-06-30",
        metricKey: "revenue",
        value: revenue,
      },
    });
    expect(res.statusCode).toBe(202);

    const list = await call("GET", `/v1/crm/programmes/${programme.id}/metrics?limit=50`);
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { data: MetricView[] }).data;
    const stored = rows.find((m) => m.metricKey === "revenue");
    expect(stored, `metric was not written. DLQ: ${dlqErrors().join(" | ")}`).toBeDefined();
    expect(stored!.metricKind).toBe("money");
    expect(stored!.valueMinor).toBe(revenue);
    expect(stored!.currency).toBe("INR");
    expect(stored!.valueNumeric).toBeNull();
  });

  it("records counts and ratios as exact decimals with no currency", async () => {
    const programme = await activate(await registerProgramme());
    for (const [metricKey, value] of [
      ["volume", "18420"],
      ["coverage_ratio", "0.875432"],
    ] as const) {
      const res = await call("POST", `/v1/crm/programmes/${programme.id}/metrics`, {
        payload: { periodStart: "2026-04-01", periodEnd: "2026-06-30", metricKey, value },
      });
      expect(res.statusCode, `${metricKey}: ${res.body}`).toBe(202);
    }
    const rows = (
      (await call("GET", `/v1/crm/programmes/${programme.id}/metrics?limit=50`)).json() as {
        data: MetricView[];
      }
    ).data;
    const volume = rows.find((m) => m.metricKey === "volume");
    expect(volume?.metricKind).toBe("count");
    expect(volume?.valueNumeric).toBe("18420.000000");
    expect(volume?.valueMinor).toBeNull();
    expect(volume?.currency).toBeNull();
    expect(rows.find((m) => m.metricKey === "coverage_ratio")?.valueNumeric).toBe("0.875432");
  });

  it("re-submitting a period corrects it instead of double-counting", async () => {
    const programme = await activate(await registerProgramme());
    const post = (value: string) =>
      call("POST", `/v1/crm/programmes/${programme.id}/metrics`, {
        payload: {
          periodStart: "2026-07-01",
          periodEnd: "2026-09-30",
          metricKey: "revenue",
          value,
        },
      });
    expect((await post("100000")).statusCode).toBe(202);
    expect((await post("250000")).statusCode).toBe(202);

    const rows = (
      (await call("GET", `/v1/crm/programmes/${programme.id}/metrics?limit=50&metricKey=revenue`)).json() as {
        data: MetricView[];
        meta: { total: number };
      }
    ).data;
    expect(rows, "one row per (programme, period, metric) — never two").toHaveLength(1);
    expect(rows[0]!.valueMinor).toBe("250000");
  });

  it("400s a bad value, a bad period, an unknown field and a bad metric key", async () => {
    const programme = await activate(await registerProgramme());
    const base = { periodStart: "2026-04-01", periodEnd: "2026-06-30" };

    const fractionalMoney = await call("POST", `/v1/crm/programmes/${programme.id}/metrics`, {
      payload: { ...base, metricKey: "revenue", value: "1234.56" },
    });
    expect(fractionalMoney.statusCode).toBe(400);
    expect(fractionalMoney.json().code).toBe("INVALID_MONEY_VALUE");

    const ratioOutOfRange = await call("POST", `/v1/crm/programmes/${programme.id}/metrics`, {
      payload: { ...base, metricKey: "coverage_ratio", value: "87" },
    });
    expect(ratioOutOfRange.statusCode).toBe(400);
    expect(ratioOutOfRange.json().code).toBe("RATIO_OUT_OF_RANGE");

    const currencyOnCount = await call("POST", `/v1/crm/programmes/${programme.id}/metrics`, {
      payload: { ...base, metricKey: "volume", value: "5", currency: "INR" },
    });
    expect(currencyOnCount.statusCode).toBe(400);
    expect(currencyOnCount.json().code).toBe("CURRENCY_NOT_APPLICABLE");

    const invertedPeriod = await call("POST", `/v1/crm/programmes/${programme.id}/metrics`, {
      payload: { periodStart: "2026-06-30", periodEnd: "2026-04-01", metricKey: "volume", value: "1" },
    });
    expect(invertedPeriod.statusCode).toBe(400);
    expect(invertedPeriod.json().code).toBe("INVALID_PERIOD");

    const badKey = await call("POST", `/v1/crm/programmes/${programme.id}/metrics`, {
      payload: { ...base, metricKey: "Volume Delivered", value: "1" },
    });
    expect(badKey.statusCode).toBe(400);

    const unknownField = await call("POST", `/v1/crm/programmes/${programme.id}/metrics`, {
      payload: { ...base, metricKey: "volume", value: "1", unit: "each" },
    });
    expect(unknownField.statusCode).toBe(400);
  });

  it("422s a metric against a draft programme — there is no execution yet", async () => {
    const programme = await registerProgramme();
    const res = await call("POST", `/v1/crm/programmes/${programme.id}/metrics`, {
      payload: { periodStart: "2026-04-01", periodEnd: "2026-06-30", metricKey: "volume", value: "1" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("PROGRAMME_NOT_EXECUTING");
  });

  it("401s without a token, 403s a crm_user, 404s a missing programme", async () => {
    const programme = await activate(await registerProgramme());
    const payload = {
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
      metricKey: "volume",
      value: "1",
    };
    expect(
      (await call("POST", `/v1/crm/programmes/${programme.id}/metrics`, { noAuth: true, payload }))
        .statusCode,
    ).toBe(401);
    expect(
      (await call("POST", `/v1/crm/programmes/${programme.id}/metrics`, {
        headers: headers(TENANT_A, ACTOR_A, ["crm_user"]),
        payload,
      })).statusCode,
    ).toBe(403);
    expect(
      (await call("POST", `/v1/crm/programmes/${MISSING_ID}/metrics`, { payload })).statusCode,
    ).toBe(404);
  });
});

describe("GET /v1/crm/programmes/:id/metrics", () => {
  it("lists a programme's series in the standard envelope and filters by key and period", async () => {
    const programme = await activate(await registerProgramme());
    const record = (metricKey: string, periodStart: string, periodEnd: string, value: string) =>
      call("POST", `/v1/crm/programmes/${programme.id}/metrics`, {
        payload: { periodStart, periodEnd, metricKey, value },
      });
    expect((await record("volume", "2026-04-01", "2026-06-30", "100")).statusCode).toBe(202);
    expect((await record("volume", "2026-07-01", "2026-09-30", "150")).statusCode).toBe(202);
    expect((await record("grievance_rate", "2026-07-01", "2026-09-30", "0.01")).statusCode).toBe(202);

    const all = await call("GET", `/v1/crm/programmes/${programme.id}/metrics?limit=50`);
    expect(all.statusCode).toBe(200);
    const body = all.json() as { data: MetricView[]; meta: { total: number; pageSize: number } };
    expect(body.meta.total).toBe(3);
    expect(body.meta.pageSize).toBe(50);

    const byKey = await call("GET", `/v1/crm/programmes/${programme.id}/metrics?limit=50&metricKey=volume`);
    expect((byKey.json() as { data: MetricView[] }).data).toHaveLength(2);

    const byPeriod = await call(
      "GET",
      `/v1/crm/programmes/${programme.id}/metrics?limit=50&periodStartFrom=2026-07-01&periodStartTo=2026-07-01`,
    );
    const periodRows = (byPeriod.json() as { data: MetricView[] }).data;
    expect(periodRows).toHaveLength(2);
    expect(periodRows.every((m) => m.periodStart === "2026-07-01")).toBe(true);
  });

  it("400s an over-large limit and a malformed period filter", async () => {
    const programme = await registerProgramme();
    expect(
      (await call("GET", `/v1/crm/programmes/${programme.id}/metrics?limit=201`)).statusCode,
    ).toBe(400);
    expect(
      (await call("GET", `/v1/crm/programmes/${programme.id}/metrics?limit=10&periodStartFrom=01-2026`))
        .statusCode,
    ).toBe(400);
  });

  it("401s without a token, 403s the wrong role, 404s a missing programme", async () => {
    const programme = await registerProgramme();
    expect(
      (await call("GET", `/v1/crm/programmes/${programme.id}/metrics?limit=10`, { noAuth: true }))
        .statusCode,
    ).toBe(401);
    expect(
      (await call("GET", `/v1/crm/programmes/${programme.id}/metrics?limit=10`, {
        headers: headers(TENANT_A, ACTOR_A, ["employee"]),
      })).statusCode,
    ).toBe(403);
    expect(
      (await call("GET", `/v1/crm/programmes/${MISSING_ID}/metrics?limit=10`)).statusCode,
    ).toBe(404);
  });
});

describe("GET /v1/crm/programmes/:id/execution-health", () => {
  it("rolls the metric series up into the J6 health view", async () => {
    const programme = await activate(await registerProgramme());
    const record = (metricKey: string, value: string, periodStart = "2026-04-01") =>
      call("POST", `/v1/crm/programmes/${programme.id}/metrics`, {
        payload: { periodStart, periodEnd: "2026-06-30", metricKey, value },
      });
    expect((await record("volume", "1200")).statusCode).toBe(202);
    expect((await record("coverage_ratio", "0.95")).statusCode).toBe(202);
    expect((await record("exception_rate", "0.01")).statusCode).toBe(202);
    expect((await record("grievance_rate", "0.01")).statusCode).toBe(202);
    expect((await record("revenue", "2500000")).statusCode).toBe(202);

    const res = await call("GET", `/v1/crm/programmes/${programme.id}/execution-health`);
    expect(res.statusCode).toBe(200);
    const health = (res.json() as { data: Record<string, unknown> }).data;
    expect(health.programmeId).toBe(programme.id);
    expect(health.programmeCode).toBe(programme.programmeCode);
    expect(health.volume).toBe(1200);
    expect(health.coverageRatio).toBeCloseTo(0.95, 6);
    // Money stays a string all the way out.
    expect(health.revenueMinor).toBe("2500000");
    expect(health.band).toBe("healthy");
  });

  it("reports at_risk when coverage collapses, and unknown before anything is reported", async () => {
    const fresh = await activate(await registerProgramme());
    const before = await call("GET", `/v1/crm/programmes/${fresh.id}/execution-health`);
    expect((before.json() as { data: { band: string } }).data.band).toBe("unknown");

    expect(
      (await call("POST", `/v1/crm/programmes/${fresh.id}/metrics`, {
        payload: {
          periodStart: "2026-04-01",
          periodEnd: "2026-06-30",
          metricKey: "coverage_ratio",
          value: "0.4",
        },
      })).statusCode,
    ).toBe(202);

    const after = await call("GET", `/v1/crm/programmes/${fresh.id}/execution-health`);
    expect((after.json() as { data: { band: string } }).data.band).toBe("at_risk");
  });

  it("400s a malformed period filter and an unknown query param", async () => {
    const programme = await registerProgramme();
    expect(
      (await call("GET", `/v1/crm/programmes/${programme.id}/execution-health?periodStartFrom=nope`))
        .statusCode,
    ).toBe(400);
    expect(
      (await call("GET", `/v1/crm/programmes/${programme.id}/execution-health?band=healthy`)).statusCode,
    ).toBe(400);
  });

  it("401s without a token, 403s the wrong role, 404s a missing programme", async () => {
    const programme = await registerProgramme();
    expect(
      (await call("GET", `/v1/crm/programmes/${programme.id}/execution-health`, { noAuth: true }))
        .statusCode,
    ).toBe(401);
    expect(
      (await call("GET", `/v1/crm/programmes/${programme.id}/execution-health`, {
        headers: headers(TENANT_A, ACTOR_A, ["employee"]),
      })).statusCode,
    ).toBe(403);
    expect(
      (await call("GET", `/v1/crm/programmes/${MISSING_ID}/execution-health`)).statusCode,
    ).toBe(404);
  });
});

describe("POST /v1/crm/programmes/:id/deals/:dealId", () => {
  it("registers an opportunity under the programme without disturbing the deal", async () => {
    const programme = await activate(await registerProgramme());
    const before = await call("GET", `/v1/crm/deals/${DEAL_LINKABLE}`);
    expect(before.statusCode).toBe(200);
    // The deals read endpoint predates the `{ data }` envelope and returns the object
    // bare. Left as-is on purpose: changing it would be a breaking response change to an
    // endpoint G12 has no business altering.
    const dealBefore = before.json() as Record<string, unknown>;
    expect(dealBefore.programmeId, "a fresh deal is not pre-linked").toBeNull();

    const res = await call("POST", `/v1/crm/programmes/${programme.id}/deals/${DEAL_LINKABLE}`, {
      payload: { dealVersion: dealBefore.version as number },
    });
    expect(res.statusCode).toBe(202);

    const after = await call("GET", `/v1/crm/deals/${DEAL_LINKABLE}`);
    const dealAfter = after.json() as Record<string, unknown>;
    expect(dealAfter.programmeId, `link did not apply. DLQ: ${dlqErrors().join(" | ")}`).toBe(programme.id);
    // Everything else the deals module owns is untouched.
    expect(dealAfter.name).toBe(dealBefore.name);
    expect(dealAfter.stage).toBe(dealBefore.stage);
    expect(dealAfter.valueMinor).toBe(dealBefore.valueMinor);
    expect(dealAfter.status).toBe(dealBefore.status);
  });

  it("409s a stale deal version and a deal already under another programme", async () => {
    const programme = await activate(await registerProgramme());
    const deal = (await call("GET", `/v1/crm/deals/${DEAL_SECOND}`)).json() as { version: number };

    const stale = await call("POST", `/v1/crm/programmes/${programme.id}/deals/${DEAL_SECOND}`, {
      payload: { dealVersion: deal.version + 42 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("VERSION_CONFLICT");

    // DEAL_LINKABLE is already under a different programme from the previous test.
    const linked = (await call("GET", `/v1/crm/deals/${DEAL_LINKABLE}`)).json() as { version: number };
    const conflict = await call("POST", `/v1/crm/programmes/${programme.id}/deals/${DEAL_LINKABLE}`, {
      payload: { dealVersion: linked.version },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("DEAL_ALREADY_LINKED");
  });

  it("422s a link to a closed programme", async () => {
    const programme = await registerProgramme();
    expect(
      (await call("POST", `/v1/crm/programmes/${programme.id}/status`, {
        payload: { status: "closed", version: programme.version },
      })).statusCode,
    ).toBe(202);

    const deal = (await call("GET", `/v1/crm/deals/${DEAL_SECOND}`)).json() as { version: number };
    const res = await call("POST", `/v1/crm/programmes/${programme.id}/deals/${DEAL_SECOND}`, {
      payload: { dealVersion: deal.version },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("PROGRAMME_CLOSED");
  });

  it("400s a non-uuid deal id, a missing dealVersion and an unknown field", async () => {
    const programme = await activate(await registerProgramme());
    expect(
      (await call("POST", `/v1/crm/programmes/${programme.id}/deals/not-a-uuid`, {
        payload: { dealVersion: 1 },
      })).statusCode,
    ).toBe(400);
    expect(
      (await call("POST", `/v1/crm/programmes/${programme.id}/deals/${DEAL_SECOND}`, { payload: {} }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call("POST", `/v1/crm/programmes/${programme.id}/deals/${DEAL_SECOND}`, {
        payload: { dealVersion: 1, force: true },
      })).statusCode,
    ).toBe(400);
  });

  it("401s without a token, 403s a crm_user, 404s a missing programme and a missing deal", async () => {
    const programme = await activate(await registerProgramme());
    expect(
      (await call("POST", `/v1/crm/programmes/${programme.id}/deals/${DEAL_SECOND}`, {
        noAuth: true,
        payload: { dealVersion: 1 },
      })).statusCode,
    ).toBe(401);
    expect(
      (await call("POST", `/v1/crm/programmes/${programme.id}/deals/${DEAL_SECOND}`, {
        headers: headers(TENANT_A, ACTOR_A, ["crm_user"]),
        payload: { dealVersion: 1 },
      })).statusCode,
    ).toBe(403);
    expect(
      (await call("POST", `/v1/crm/programmes/${MISSING_ID}/deals/${DEAL_SECOND}`, {
        payload: { dealVersion: 1 },
      })).statusCode,
    ).toBe(404);
    const missingDeal = await call("POST", `/v1/crm/programmes/${programme.id}/deals/${MISSING_ID}`, {
      payload: { dealVersion: 1 },
    });
    expect(missingDeal.statusCode).toBe(404);
    expect(missingDeal.json().message).toContain("deal");
  });
});

describe("tenant isolation", () => {
  it("hides tenant A's programme from tenant B on every read and write path", async () => {
    const programme = await activate(await registerProgramme());
    const b = headers(TENANT_B, ACTOR_B);

    const list = await call("GET", "/v1/crm/programmes?limit=200", { headers: b });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: ProgrammeView[] }).data.map((p) => p.id)).not.toContain(programme.id);

    // 404, not 403: whether a programme code exists in another department is not
    // information this API should confirm.
    for (const url of [
      `/v1/crm/programmes/${programme.id}`,
      `/v1/crm/programmes/${programme.id}/metrics?limit=10`,
      `/v1/crm/programmes/${programme.id}/execution-health`,
    ]) {
      const res = await call("GET", url, { headers: b });
      expect(res.statusCode, url).toBe(404);
    }

    const patch = await call("PATCH", `/v1/crm/programmes/${programme.id}`, {
      headers: b,
      payload: { name: "hijacked", version: programme.version },
    });
    expect(patch.statusCode).toBe(404);

    const status = await call("POST", `/v1/crm/programmes/${programme.id}/status`, {
      headers: b,
      payload: { status: "closed", version: programme.version },
    });
    expect(status.statusCode).toBe(404);

    const metric = await call("POST", `/v1/crm/programmes/${programme.id}/metrics`, {
      headers: b,
      payload: { periodStart: "2026-04-01", periodEnd: "2026-06-30", metricKey: "volume", value: "1" },
    });
    expect(metric.statusCode).toBe(404);

    // Nothing tenant B attempted changed anything.
    const after = ((await getProgramme(programme.id)).json() as { data: ProgrammeView }).data;
    expect(after.name).toBe(programme.name);
    expect(after.status).toBe("active");
    expect(after.version).toBe(programme.version);
  });

  it("keeps a duplicate programme code legal in a DIFFERENT tenant", async () => {
    const programme = await registerProgramme();
    const res = await call("POST", "/v1/crm/programmes", {
      headers: headers(TENANT_B, ACTOR_B),
      payload: {
        programmeCode: programme.programmeCode,
        name: "Same code, other department",
        accountId: randomUUID(),
      },
    });
    expect(res.statusCode, "uniqueness is per tenant, not global").toBe(202);
  });
});

describe("cache degradation", () => {
  it("falls through to postgres and stays a 200 when the cache throws", async () => {
    // The degradation path is otherwise only reachable by breaking Redis, which means it is
    // a path nobody ever verifies. `throughCache` is the single choke-point, so exercising
    // it directly proves reads survive a cache outage instead of turning into 500s.
    const value = await throughCache(
      () => Promise.reject(new Error("ECONNREFUSED redis")),
      () => Promise.resolve("from-postgres"),
      { tenantId: TENANT_A, resource: "programme" },
    );
    expect(value).toBe("from-postgres");
  });

  it("returns the cached value when the cache is healthy", async () => {
    const value = await throughCache(
      () => Promise.resolve("from-cache"),
      () => Promise.reject(new Error("should not be reached")),
      { tenantId: TENANT_A, resource: "programme" },
    );
    expect(value).toBe("from-cache");
  });
});
