/**
 * GAP-CRM-QUALIFICATION-FRAMEWORKS-02 — a framework PUT must honour the row
 * `version` so two admins editing at once cannot silently clobber each other.
 * Before the fix, PUT ignored version entirely and (when questions were sent)
 * deleted+reinserted the whole set, so the losing edit vanished without a trace.
 *
 * DB-backed, HTTP round-trip.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[] = ["crm_admin"]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-qfw" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

async function call(method: "GET" | "POST" | "PUT", url: string, payload?: unknown) {
  const app = await buildApp();
  const res = await app.inject({
    method,
    url,
    headers: headers(),
    ...(payload === undefined ? {} : { payload }),
  });
  await app.close();
  await drainQueue();
  return res;
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup(): Promise<void> {
  await scoped((tx) => tx`DELETE FROM crm.lead_qualifications WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`DELETE FROM crm.qualification_questions WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`DELETE FROM crm.qualification_frameworks WHERE tenant_id = ${TENANT}`).catch(() => {});
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

async function createFramework(): Promise<{ id: string; version: number }> {
  const res = await call("POST", "/v1/crm/qualification-frameworks", {
    name: "Enterprise Fit",
    businessLine: "enterprise",
    questions: [{ prompt: "Budget approved?", answerType: "bool", weight: 100, outcomeRule: {} }],
  });
  expect(res.statusCode).toBe(201);
  const data = res.json().data as { id: string; version: number };
  return { id: data.id, version: data.version };
}

describe("GAP-CRM-QUALIFICATION-FRAMEWORKS-02: optimistic locking on framework PUT", () => {
  it("rejects a stale version with 409 VERSION_CONFLICT", async () => {
    const { id, version } = await createFramework();

    const first = await call("PUT", `/v1/crm/qualification-frameworks/${id}`, {
      name: "Enterprise Fit (edited by admin A)",
      version,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.version).toBe(version + 1);

    // Admin B still holds the OLD version.
    const second = await call("PUT", `/v1/crm/qualification-frameworks/${id}`, {
      name: "Enterprise Fit (edited by admin B)",
      version,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error?.code ?? second.json().code).toBe("VERSION_CONFLICT");

    // Admin A's change stands; B's stale write did not apply.
    const after = (await call("GET", `/v1/crm/qualification-frameworks/${id}`)).json().data;
    expect(after.name).toBe("Enterprise Fit (edited by admin A)");
  });

  it("accepts a fresh version and still works without a version (backward compatible)", async () => {
    const { id, version } = await createFramework();
    const fresh = await call("PUT", `/v1/crm/qualification-frameworks/${id}`, { active: false, version });
    expect(fresh.statusCode).toBe(200);

    const noVersion = await call("PUT", `/v1/crm/qualification-frameworks/${id}`, { active: true });
    expect(noVersion.statusCode).toBe(200);
  });

  it("404s a missing framework even when a version is supplied", async () => {
    const res = await call("PUT", `/v1/crm/qualification-frameworks/${randomUUID()}`, { active: false, version: 1 });
    expect(res.statusCode).toBe(404);
  });
});

describe("GAP-CRM-QUALIFICATION-FRAMEWORKS-02: removing an answered question is refused (409 QUESTION_HAS_ANSWERS)", () => {
  async function seedAnswered() {
    const { id, version } = await createFramework();
    const fw = (await call("GET", `/v1/crm/qualification-frameworks/${id}`)).json().data as {
      version: number;
      questions: Array<{ id: string }>;
    };
    const qid = fw.questions[0]!.id;
    await scoped(
      (tx) => tx`INSERT INTO crm.lead_qualifications (tenant_id, lead_id, framework_id, answers, outcome, score, qualified_by)
        VALUES (${TENANT}, ${randomUUID()}, ${id}, ${JSON.stringify({ [qid]: true })}::jsonb, 'qualified', 100, ${ACTOR})`,
    );
    return { id, version: fw.version ?? version, qid };
  }

  it("refuses to drop a question that leads have answered, leaving it and its answers intact", async () => {
    const { id, version, qid } = await seedAnswered();
    const res = await call("PUT", `/v1/crm/qualification-frameworks/${id}`, {
      version,
      questions: [{ prompt: "A brand new question", answerType: "bool", weight: 10, outcomeRule: {} }],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error?.code ?? res.json().code).toBe("QUESTION_HAS_ANSWERS");
    const after = (await call("GET", `/v1/crm/qualification-frameworks/${id}`)).json().data as {
      version: number;
      questions: Array<{ id: string }>;
    };
    expect(after.questions.map((q) => q.id)).toEqual([qid]);
    expect(after.version).toBe(version); // whole update rolled back
  });

  it("keeps the same question id (answers stay attached) when it is sent back with its id", async () => {
    const { id, version, qid } = await seedAnswered();
    const res = await call("PUT", `/v1/crm/qualification-frameworks/${id}`, {
      version,
      questions: [
        { id: qid, prompt: "Budget approved? (reworded)", answerType: "bool", weight: 50, outcomeRule: {} },
        { prompt: "Timeline under 6 months?", answerType: "bool", weight: 50, outcomeRule: {}, order: 1 },
      ],
    });
    expect(res.statusCode).toBe(200);
    const qs = res.json().data.questions as Array<{ id: string; prompt: string }>;
    expect(qs).toHaveLength(2);
    expect(qs.find((q) => q.id === qid)?.prompt).toBe("Budget approved? (reworded)");
  });

  it("allows dropping an unanswered question", async () => {
    const { id, version } = await createFramework();
    const res = await call("PUT", `/v1/crm/qualification-frameworks/${id}`, {
      version,
      questions: [{ prompt: "Replacement", answerType: "bool", weight: 5, outcomeRule: {} }],
    });
    expect(res.statusCode).toBe(200);
  });
});
