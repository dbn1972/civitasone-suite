/**
 * G7 — checklist-driven cases over HTTP: versioned templates, frozen instances,
 * partial saves, completion reporting.
 *
 * Writes are CQRS, so every mutation returns 202 and state is asserted through the read
 * path only after the queue has drained. The three journeys this exists for (exporter
 * readiness, insurance proposal, B2B onboarding) are exercised as real templates rather
 * than as abstract fixtures — a model that cannot express them is the failure this is
 * guarding against.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { ChecklistSection } from "@civitasone/checklist";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { captureHandlers, drainQueue, envelope } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "aaaaaaaa-1111-4000-8000-000000000097";
const TENANT_B = "bbbbbbbb-2222-4000-8000-000000000097";
const ACTOR_A = "cccccccc-3333-4000-8000-000000000097";
const ACTOR_B = "dddddddd-4444-4000-8000-000000000097";
const SUBJECT_ACCOUNT = "eeeeeeee-5555-4000-8000-000000000097";
const SUBJECT_ACCOUNT_2 = "eeeeeeee-6666-4000-8000-000000000097";
const SUBJECT_CASE = "ffffffff-7777-4000-8000-000000000097";
const MISSING = "00000000-0000-4000-8000-000000000099";

/** A distinctive answer value used to prove no event payload ever carries answer content. */
const SENSITIVE_ANSWER = "MEDICAL-HISTORY-DIABETES-TYPE-2";

type TemplateView = {
  id: string;
  templateKey: string;
  name: string;
  description: string | null;
  sections: ChecklistSection[];
  versionNumber: number;
  status: string;
  publishedAt: string | null;
  version: number;
};

type InstanceView = {
  id: string;
  subjectType: string;
  subjectId: string;
  templateId: string;
  templateKey: string;
  templateVersionNumber: number;
  structure: ChecklistSection[];
  responses: Record<string, { value: unknown; answeredAt: string }>;
  status: string;
  score: number;
  completedAt: string | null;
  version: number;
};

type CompletionView = {
  instanceId: string;
  status: string;
  complete: boolean;
  progressPercent: number;
  requiredTotal: number;
  requiredAnswered: number;
  unansweredRequired: Array<{ questionId: string; sectionId: string; text: string }>;
  sectionScores: Record<string, number>;
  score: number;
  availableSectionIds: string[];
  lockedSectionIds: string[];
};

// ── journey fixtures ──────────────────────────────────────────────────────────

const EXPORTER_SECTIONS: ChecklistSection[] = [
  {
    id: "registration",
    title: "Statutory registration",
    sortOrder: 1,
    weight: 2,
    questions: [
      { id: "has_iec", text: "Do you hold an IEC?", type: "boolean", sortOrder: 1, weight: 1, required: true },
      {
        id: "iec_number",
        text: "IEC number",
        type: "text",
        sortOrder: 2,
        weight: 1,
        required: true,
        conditionalLogic: [{ dependsOn: "has_iec", operator: "eq", value: true, action: "show" }],
      },
    ],
  },
  {
    id: "banking",
    title: "AD code and banking",
    sortOrder: 2,
    weight: 1,
    prerequisite: { sectionId: "registration", minScore: 100 },
    questions: [
      { id: "ad_code", text: "AD code", type: "text", sortOrder: 1, weight: 1, required: true },
    ],
  },
];

const INSURANCE_SECTIONS: ChecklistSection[] = [
  {
    id: "proposer",
    title: "Proposer",
    sortOrder: 1,
    weight: 1,
    questions: [
      { id: "sum_assured", text: "Sum assured", type: "number", sortOrder: 1, weight: 1, required: true },
    ],
  },
  {
    id: "medical",
    title: "Medical requirements",
    sortOrder: 2,
    weight: 1,
    questions: [
      {
        id: "medical_history",
        text: "Medical history",
        type: "text",
        sortOrder: 1,
        weight: 1,
        required: true,
        conditionalLogic: [{ dependsOn: "sum_assured", operator: "gt", value: 5000000, action: "show" }],
      },
    ],
  },
];

const B2B_SECTIONS: ChecklistSection[] = [
  {
    id: "kyb",
    title: "Know your business",
    sortOrder: 1,
    weight: 1,
    questions: [
      { id: "gstin", text: "GSTIN", type: "text", sortOrder: 1, weight: 1, required: true },
    ],
  },
];

// ── plumbing ──────────────────────────────────────────────────────────────────

function headers(
  roles: string[] = ["crm_admin"],
  tenantId: string = TENANT_A,
  actorId: string = ACTOR_A,
): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-g7" }, SECRET)}`,
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

async function cleanup(): Promise<void> {
  for (const tenant of [TENANT_A, TENANT_B]) {
    await scoped(tenant, async (tx) => {
      await tx`DELETE FROM crm.checklist_instances WHERE tenant_id = ${tenant}`;
      await tx`DELETE FROM crm.checklist_templates WHERE tenant_id = ${tenant}`;
      await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${tenant}`;
    }).catch(() => {});
  }
}

/** Outbox event payloads for one topic, oldest first. */
async function eventsOf(topic: string, tenantId = TENANT_A): Promise<Array<Record<string, unknown>>> {
  const rows = (await scoped(tenantId, (tx) => tx`
    SELECT payload FROM _outbox.messages
    WHERE tenant_id = ${tenantId} AND event_type = ${topic}
    ORDER BY created_at
  `)) as unknown as Array<{ payload: Record<string, unknown> }>;
  return rows.map((r) => r.payload);
}

/** Audit outcomes recorded against one resource, oldest first. */
async function auditOutcomes(resourceId: string, tenantId = TENANT_A): Promise<string[]> {
  const rows = (await scoped(tenantId, (tx) => tx`
    SELECT payload FROM _outbox.messages
    WHERE tenant_id = ${tenantId} AND event_type = 'audit.event.record'
      AND payload->>'resourceId' = ${resourceId}
    ORDER BY created_at
  `)) as unknown as Array<{ payload: { outcome: string } }>;
  return rows.map((r) => r.payload.outcome);
}

async function createTemplate(
  body: Record<string, unknown>,
  hdrs?: Record<string, string>,
) {
  return call("POST", "/v1/crm/checklist-templates", { payload: body, ...(hdrs ? { headers: hdrs } : {}) });
}

async function listTemplates(templateKey?: string, hdrs?: Record<string, string>): Promise<TemplateView[]> {
  const url = templateKey
    ? `/v1/crm/checklist-templates?limit=200&templateKey=${templateKey}`
    : "/v1/crm/checklist-templates?limit=200";
  const res = await call("GET", url, hdrs ? { headers: hdrs } : {});
  expect(res.statusCode).toBe(200);
  return res.json().data as TemplateView[];
}

async function templateVersion(templateKey: string, versionNumber: number): Promise<TemplateView> {
  const found = (await listTemplates(templateKey)).find((t) => t.versionNumber === versionNumber);
  expect(found, `template ${templateKey} v${versionNumber} should exist`).toBeDefined();
  return found as TemplateView;
}

async function getTemplate(id: string): Promise<TemplateView> {
  const res = await call("GET", `/v1/crm/checklist-templates/${id}`);
  expect(res.statusCode).toBe(200);
  return res.json().data as TemplateView;
}

async function getInstance(id: string): Promise<InstanceView> {
  const res = await call("GET", `/v1/crm/checklist-instances/${id}`);
  expect(res.statusCode).toBe(200);
  return res.json().data as InstanceView;
}

async function completionOf(id: string): Promise<CompletionView> {
  const res = await call("GET", `/v1/crm/checklist-instances/${id}/completion`);
  expect(res.statusCode).toBe(200);
  return res.json().data as CompletionView;
}

/** Create + publish a template in one go, returning the published row. */
async function publishedTemplate(
  templateKey: string,
  name: string,
  sections: ChecklistSection[],
): Promise<TemplateView> {
  const created = await createTemplate({ templateKey, name, sections });
  expect(created.statusCode, `create ${templateKey}`).toBe(202);
  const draft = await templateVersion(templateKey, 1);
  const published = await call("POST", `/v1/crm/checklist-templates/${draft.id}/publish`, { payload: {} });
  expect(published.statusCode, `publish ${templateKey}`).toBe(202);
  return getTemplate(draft.id);
}

async function raiseInstance(
  templateKey: string,
  subjectType: string,
  subjectId: string,
): Promise<InstanceView> {
  const res = await call("POST", "/v1/crm/checklist-instances", {
    payload: { subjectType, subjectId, templateKey },
  });
  expect(res.statusCode, `raise ${templateKey}`).toBe(202);
  const list = await call(
    "GET",
    `/v1/crm/checklist-instances?limit=200&subjectId=${subjectId}&templateKey=${templateKey}`,
  );
  expect(list.statusCode).toBe(200);
  const rows = list.json().data as InstanceView[];
  expect(rows.length, "instance should exist after the command drains").toBeGreaterThan(0);
  return rows[0] as InstanceView;
}

function answer(id: string, answers: Array<{ questionId: string; value: unknown }>, version?: number) {
  return call("POST", `/v1/crm/checklist-instances/${id}/responses`, {
    payload: { answers, ...(version === undefined ? {} : { version }) },
  });
}

beforeAll(async () => {
  await cleanup();
  registerAllConsumers(queue);
  await queue.start();
  // Two templates published up front so the instance tests have something in force.
  // `exporter_readiness` and `b2b_onboarding` are deliberately built inside the
  // versioning tests instead, because their lifecycle IS what those tests assert.
  await publishedTemplate("insurance_proposal", "Insurance proposal", INSURANCE_SECTIONS);
  await publishedTemplate("b2b_onboarding_live", "B2B onboarding (live)", B2B_SECTIONS);
});

afterAll(async () => {
  await drainQueue();
  await cleanup();
  await sqlClient.end();
});

// ══════════════════════════════════════════════════════════════════════════════
describe("G7 template versioning", () => {
  it("creates a draft at version 1 and publishes it", async () => {
    const created = await createTemplate({
      templateKey: "exporter_readiness",
      name: "Exporter readiness",
      description: "IEC and AD-code guidance",
      sections: EXPORTER_SECTIONS,
    });
    expect(created.statusCode).toBe(202);
    expect(created.json().status).toBe("accepted");

    const draft = await templateVersion("exporter_readiness", 1);
    expect(draft.status).toBe("draft");
    expect(draft.publishedAt).toBeNull();
    expect(draft.sections).toHaveLength(2);

    const published = await call("POST", `/v1/crm/checklist-templates/${draft.id}/publish`, { payload: {} });
    expect(published.statusCode).toBe(202);

    const after = await getTemplate(draft.id);
    expect(after.status).toBe("published");
    expect(after.publishedAt).not.toBeNull();
    expect(after.version).toBe(draft.version + 1);

    const events = await eventsOf(EVENTS.checklistTemplatePublished);
    expect(events.some((e) => e.templateId === draft.id)).toBe(true);
  });

  it("refuses to edit a published template — a new version is the only route", async () => {
    const published = await templateVersion("exporter_readiness", 1);
    const res = await call("PATCH", `/v1/crm/checklist-templates/${published.id}`, {
      payload: { name: "Renamed" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("TEMPLATE_IMMUTABLE");
    expect((await getTemplate(published.id)).name).toBe("Exporter readiness");
  });

  it("amends a draft in place", async () => {
    const created = await createTemplate({
      templateKey: "b2b_onboarding",
      name: "B2B onboarding",
      sections: B2B_SECTIONS,
    });
    expect(created.statusCode).toBe(202);
    const draft = await templateVersion("b2b_onboarding", 1);

    const patched = await call("PATCH", `/v1/crm/checklist-templates/${draft.id}`, {
      payload: { name: "B2B customer onboarding", description: "KYB and commercials" },
    });
    expect(patched.statusCode).toBe(202);

    const after = await getTemplate(draft.id);
    expect(after.name).toBe("B2B customer onboarding");
    expect(after.description).toBe("KYB and commercials");
    expect(after.version).toBe(draft.version + 1);
  });

  it("publishing v2 deprecates v1, leaving exactly one published version", async () => {
    const v2 = await createTemplate({
      templateKey: "exporter_readiness",
      name: "Exporter readiness v2",
      sections: [
        ...EXPORTER_SECTIONS,
        {
          id: "logistics",
          title: "Logistics",
          sortOrder: 3,
          weight: 1,
          // Chained behind banking, which is itself behind registration: the engine must
          // keep logistics locked while registration is outstanding even though banking's
          // own score would satisfy this threshold.
          prerequisite: { sectionId: "banking", minScore: 100 },
          questions: [
            { id: "incoterm", text: "Incoterm", type: "select", sortOrder: 1, weight: 1, required: true },
          ],
        },
      ],
    });
    expect(v2.statusCode).toBe(202);

    const draft2 = await templateVersion("exporter_readiness", 2);
    expect(draft2.status).toBe("draft");

    const published = await call("POST", `/v1/crm/checklist-templates/${draft2.id}/publish`, { payload: {} });
    expect(published.statusCode).toBe(202);

    const versions = await listTemplates("exporter_readiness");
    const byNumber = new Map(versions.map((t) => [t.versionNumber, t.status]));
    expect(byNumber.get(1)).toBe("deprecated");
    expect(byNumber.get(2)).toBe("published");
    expect(versions.filter((t) => t.status === "published")).toHaveLength(1);

    const events = await eventsOf(EVENTS.checklistTemplatePublished);
    const publishV2 = events.find((e) => e.templateId === draft2.id);
    expect(publishV2?.supersededTemplateId).toBeDefined();
  });

  it("refuses to publish a template with no questions", async () => {
    const created = await createTemplate({
      templateKey: "empty_checklist",
      name: "Empty",
      sections: [{ id: "s1", title: "Nothing", sortOrder: 1, weight: 1, questions: [] }],
    });
    expect(created.statusCode).toBe(202);
    const draft = await templateVersion("empty_checklist", 1);

    const res = await call("POST", `/v1/crm/checklist-templates/${draft.id}/publish`, { payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("TEMPLATE_EMPTY");
    expect((await getTemplate(draft.id)).status).toBe("draft");
  });

  it("rejects a structurally invalid template at the boundary", async () => {
    const duplicate = await createTemplate({
      templateKey: "broken_dupes",
      name: "Broken",
      sections: [
        {
          id: "s1",
          title: "S1",
          sortOrder: 1,
          weight: 1,
          questions: [
            { id: "q1", text: "A", type: "text", sortOrder: 1, weight: 1, required: true },
            { id: "q1", text: "B", type: "text", sortOrder: 2, weight: 1, required: true },
          ],
        },
      ],
    });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().code).toBe("DUPLICATE_QUESTION_IDS");

    const cyclic = await createTemplate({
      templateKey: "broken_cycle",
      name: "Broken cycle",
      sections: [
        {
          id: "a", title: "A", sortOrder: 1, weight: 1,
          prerequisite: { sectionId: "b", minScore: 50 },
          questions: [{ id: "qa", text: "A", type: "text", sortOrder: 1, weight: 1, required: true }],
        },
        {
          id: "b", title: "B", sortOrder: 2, weight: 1,
          prerequisite: { sectionId: "a", minScore: 50 },
          questions: [{ id: "qb", text: "B", type: "text", sortOrder: 1, weight: 1, required: true }],
        },
      ],
    });
    expect(cyclic.statusCode).toBe(400);
    expect(cyclic.json().code).toBe("PREREQUISITE_CYCLE");

    const dangling = await createTemplate({
      templateKey: "broken_ref",
      name: "Broken ref",
      sections: [
        {
          id: "s1", title: "S1", sortOrder: 1, weight: 1,
          questions: [
            {
              id: "q1", text: "A", type: "text", sortOrder: 1, weight: 1, required: true,
              conditionalLogic: [{ dependsOn: "ghost", operator: "eq", value: "x", action: "show" }],
            },
          ],
        },
      ],
    });
    expect(dangling.statusCode).toBe(400);
    expect(dangling.json().code).toBe("UNKNOWN_CONDITION_DEPENDENCY");
  });

  it("deprecates a draft that will never be published", async () => {
    const draft = await templateVersion("empty_checklist", 1);
    const res = await call("POST", `/v1/crm/checklist-templates/${draft.id}/deprecate`, { payload: {} });
    expect(res.statusCode).toBe(202);

    const after = await getTemplate(draft.id);
    expect(after.status).toBe("deprecated");

    // Terminal: a second deprecate is refused at the route, not silently accepted.
    const again = await call("POST", `/v1/crm/checklist-templates/${after.id}/deprecate`, { payload: {} });
    expect(again.statusCode).toBe(422);
    expect(again.json().code).toBe("INVALID_TRANSITION");
  });

  it("rejects a stale version with 409 rather than accepting a command that would be dropped", async () => {
    const draft = await templateVersion("b2b_onboarding", 1);
    const res = await call("PATCH", `/v1/crm/checklist-templates/${draft.id}`, {
      payload: { name: "Nope", version: 99 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("G7 instances — frozen structure", () => {
  it("raises an instance from the published version of a key", async () => {
    const instance = await raiseInstance("exporter_readiness", "account", SUBJECT_ACCOUNT);
    expect(instance.status).toBe("in_progress");
    expect(instance.templateVersionNumber).toBe(2);
    expect(instance.structure).toHaveLength(3);
    expect(instance.responses).toEqual({});
    expect(instance.completedAt).toBeNull();

    const created = await eventsOf(EVENTS.checklistInstanceCreated);
    const event = created.find((e) => e.instanceId === instance.id);
    expect(event).toBeDefined();
    expect(event?.requiredTotal).toBe(1); // only has_iec is visible + unlocked at the start
  });

  it("refuses a second open instance of the same checklist for one subject", async () => {
    const res = await call("POST", "/v1/crm/checklist-instances", {
      payload: { subjectType: "account", subjectId: SUBJECT_ACCOUNT, templateKey: "exporter_readiness" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("OPEN_INSTANCE_EXISTS");
  });

  it("refuses to instantiate a draft or deprecated template by id", async () => {
    const draft = await templateVersion("b2b_onboarding", 1);
    const res = await call("POST", "/v1/crm/checklist-instances", {
      payload: { subjectType: "account", subjectId: SUBJECT_ACCOUNT_2, templateId: draft.id },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("TEMPLATE_NOT_PUBLISHED");
  });

  it("a template version published later does not change an in-flight instance", async () => {
    const before = (await call(
      "GET",
      `/v1/crm/checklist-instances?limit=200&subjectId=${SUBJECT_ACCOUNT}&templateKey=exporter_readiness`,
    )).json().data as InstanceView[];
    const instance = before[0] as InstanceView;
    const frozenIds = instance.structure.map((s) => s.id);

    // Publish a v3 with a completely different shape.
    const v3 = await createTemplate({
      templateKey: "exporter_readiness",
      name: "Exporter readiness v3",
      sections: [
        {
          id: "totally_new", title: "New", sortOrder: 1, weight: 1,
          questions: [{ id: "brand_new", text: "New?", type: "boolean", sortOrder: 1, weight: 1, required: true }],
        },
      ],
    });
    expect(v3.statusCode).toBe(202);
    const draft3 = await templateVersion("exporter_readiness", 3);
    expect((await call("POST", `/v1/crm/checklist-templates/${draft3.id}/publish`, { payload: {} })).statusCode).toBe(202);

    const after = await getInstance(instance.id);
    expect(after.structure.map((s) => s.id)).toEqual(frozenIds);
    expect(after.templateVersionNumber).toBe(2);
    // And the completion report is still computed against the frozen copy.
    expect((await completionOf(instance.id)).unansweredRequired.map((o) => o.questionId)).toEqual(["has_iec"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("G7 responses — partial saves and completion", () => {
  let instanceId: string;

  beforeAll(async () => {
    const list = (await call(
      "GET",
      `/v1/crm/checklist-instances?limit=200&subjectId=${SUBJECT_ACCOUNT}&templateKey=exporter_readiness`,
    )).json().data as InstanceView[];
    instanceId = (list[0] as InstanceView).id;
  });

  it("reports progress, outstanding items and score before anything is answered", async () => {
    const state = await completionOf(instanceId);
    expect(state.complete).toBe(false);
    expect(state.progressPercent).toBe(0);
    expect(state.requiredTotal).toBe(1);
    expect(state.requiredAnswered).toBe(0);
    expect(state.unansweredRequired).toEqual([
      { questionId: "has_iec", sectionId: "registration", text: "Do you hold an IEC?" },
    ]);
    expect(state.lockedSectionIds).toEqual(["banking", "logistics"]);
    expect(state.score).toBe(0);
  });

  it("accepts a partial save and reveals the conditional follow-up", async () => {
    const res = await answer(instanceId, [{ questionId: "has_iec", value: true }]);
    expect(res.statusCode).toBe(202);

    const state = await completionOf(instanceId);
    expect(state.complete).toBe(false);
    expect(state.unansweredRequired.map((o) => o.questionId)).toEqual(["iec_number"]);
    expect(state.status).toBe("in_progress");

    const answered = await eventsOf(EVENTS.checklistItemAnswered);
    const event = answered.find((e) => e.instanceId === instanceId);
    expect(event?.questionIds).toEqual(["has_iec"]);
    expect(event?.progressPercent).toBe(50);
  });

  it("unlocks the gated section once its prerequisite is met", async () => {
    expect((await answer(instanceId, [{ questionId: "iec_number", value: "0312345678" }])).statusCode).toBe(202);

    const state = await completionOf(instanceId);
    // banking unlocks; logistics is chained behind banking and stays locked.
    expect(state.availableSectionIds).toEqual(["registration", "banking"]);
    expect(state.lockedSectionIds).toEqual(["logistics"]);
    expect(state.unansweredRequired.map((o) => o.questionId)).toEqual(["ad_code"]);
  });

  it("completes the instance when the last outstanding item is answered", async () => {
    expect((await answer(instanceId, [
      { questionId: "ad_code", value: "6390004" },
      { questionId: "incoterm", value: "FOB" },
    ])).statusCode).toBe(202);

    const after = await getInstance(instanceId);
    expect(after.status).toBe("completed");
    expect(after.completedAt).not.toBeNull();
    expect(after.score).toBe(100);

    const completed = await eventsOf(EVENTS.checklistInstanceCompleted);
    const event = completed.find((e) => e.instanceId === instanceId);
    expect(event).toBeDefined();
    expect(event?.templateKey).toBe("exporter_readiness");
    expect(event?.score).toBe(100);
  });

  it("refuses further answers once completed", async () => {
    const res = await answer(instanceId, [{ questionId: "ad_code", value: "9999999" }]);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INSTANCE_NOT_OPEN");
  });

  it("rejects an answer to a question the frozen structure does not define", async () => {
    const fresh = await raiseInstance("b2b_onboarding_live", "onboarding_case", SUBJECT_CASE);
    const res = await answer(fresh.id, [{ questionId: "not_a_question", value: "x" }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("UNKNOWN_QUESTION");
    expect((await getInstance(fresh.id)).responses).toEqual({});
  });

  it("rejects a stale version with 409", async () => {
    const list = (await call(
      "GET",
      `/v1/crm/checklist-instances?limit=200&subjectId=${SUBJECT_CASE}`,
    )).json().data as InstanceView[];
    const id = (list[0] as InstanceView).id;
    const res = await answer(id, [{ questionId: "gstin", value: "27AAAAA0000A1Z5" }], 99);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });

  it("stores an answer to a currently-hidden question without counting it", async () => {
    const instance = await raiseInstance("insurance_proposal", "contact", SUBJECT_ACCOUNT_2);
    // Answer the conditional question while it is still hidden (sum_assured unanswered).
    expect((await answer(instance.id, [{ questionId: "medical_history", value: SENSITIVE_ANSWER }])).statusCode).toBe(202);

    const hidden = await completionOf(instance.id);
    expect(hidden.requiredTotal).toBe(1);
    expect(hidden.unansweredRequired.map((o) => o.questionId)).toEqual(["sum_assured"]);

    // A low sum assured leaves it hidden, so the checklist completes without it.
    expect((await answer(instance.id, [{ questionId: "sum_assured", value: 100000 }])).statusCode).toBe(202);
    const done = await getInstance(instance.id);
    expect(done.status).toBe("completed");
    // The stored answer survived — it was never discarded, only uncounted.
    expect(done.responses.medical_history?.value).toBe(SENSITIVE_ANSWER);
  });

  it("demands the medical question once the sum assured crosses the threshold", async () => {
    const subject = randomUUID();
    const instance = await raiseInstance("insurance_proposal", "contact", subject);
    expect((await answer(instance.id, [{ questionId: "sum_assured", value: 9000000 }])).statusCode).toBe(202);

    const state = await completionOf(instance.id);
    expect(state.complete).toBe(false);
    expect(state.unansweredRequired.map((o) => o.questionId)).toEqual(["medical_history"]);
    expect((await getInstance(instance.id)).status).toBe("in_progress");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("G7 events carry no answer content (DPDP)", () => {
  it("no checklist event payload contains a submitted answer value", async () => {
    const topics = [
      EVENTS.checklistInstanceCreated,
      EVENTS.checklistItemAnswered,
      EVENTS.checklistInstanceCompleted,
      EVENTS.checklistTemplateCreated,
      EVENTS.checklistTemplatePublished,
    ];
    for (const topic of topics) {
      const payloads = await eventsOf(topic);
      expect(payloads.length, `expected some ${topic} events`).toBeGreaterThan(0);
      const serialised = JSON.stringify(payloads);
      expect(serialised).not.toContain(SENSITIVE_ANSWER);
      expect(serialised).not.toContain("0312345678");
      expect(serialised).not.toContain("6390004");
    }
  });

  it("the answered event names the questions but not their answers", async () => {
    const payloads = await eventsOf(EVENTS.checklistItemAnswered);
    for (const payload of payloads) {
      expect(Array.isArray(payload.questionIds)).toBe(true);
      expect(payload).not.toHaveProperty("responses");
      expect(payload).not.toHaveProperty("answers");
      expect(payload).not.toHaveProperty("value");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("G7 consumer guards", () => {
  it("a redelivered submit command applies exactly once", async () => {
    const subject = randomUUID();
    const instance = await raiseInstance("b2b_onboarding_live", "account", subject);
    const before = await getInstance(instance.id);

    const handler = captureHandlers().handlerFor(COMMANDS.submitChecklistResponses);
    const messageId = randomUUID();
    const msg = envelope(COMMANDS.submitChecklistResponses, {
      id: instance.id,
      tenantId: TENANT_A,
      responses: { gstin: { value: "27AAAAA0000A1Z5", answeredAt: new Date().toISOString() } },
      version: before.version,
    }, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });

    await runWithTenant(TENANT_A, () => handler(msg));
    await runWithTenant(TENANT_A, () => handler(msg));

    const after = await getInstance(instance.id);
    expect(after.version).toBe(before.version + 1);
    expect(after.status).toBe("completed");
  });

  it("a stale submit command is audited, not silently dropped", async () => {
    const subject = randomUUID();
    const instance = await raiseInstance("b2b_onboarding_live", "account", subject);

    const handler = captureHandlers().handlerFor(COMMANDS.submitChecklistResponses);
    const msg = envelope(COMMANDS.submitChecklistResponses, {
      id: instance.id,
      tenantId: TENANT_A,
      responses: { gstin: { value: "x", answeredAt: new Date().toISOString() } },
      version: 99,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    await runWithTenant(TENANT_A, () => handler(msg));

    expect(await auditOutcomes(instance.id)).toContain("rejected_stale_state");
    expect((await getInstance(instance.id)).responses).toEqual({});
  });

  it("a submit command for an unknown instance is audited as not found", async () => {
    const handler = captureHandlers().handlerFor(COMMANDS.submitChecklistResponses);
    const msg = envelope(COMMANDS.submitChecklistResponses, {
      id: MISSING,
      tenantId: TENANT_A,
      responses: {},
      version: 1,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    await runWithTenant(TENANT_A, () => handler(msg));
    expect(await auditOutcomes(MISSING)).toContain("rejected_not_found");
  });

  it("a publish command against a published template is audited as stale", async () => {
    const published = await templateVersion("exporter_readiness", 3);
    const handler = captureHandlers().handlerFor(COMMANDS.publishChecklistTemplate);
    const msg = envelope(COMMANDS.publishChecklistTemplate, {
      id: published.id,
      tenantId: TENANT_A,
      templateKey: published.templateKey,
      versionNumber: published.versionNumber,
      version: published.version,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    await runWithTenant(TENANT_A, () => handler(msg));
    expect(await auditOutcomes(published.id)).toContain("rejected_stale_state");
  });

  it("an update command against a published template is audited by status", async () => {
    const published = await templateVersion("exporter_readiness", 3);
    const handler = captureHandlers().handlerFor(COMMANDS.updateChecklistTemplate);
    const msg = envelope(COMMANDS.updateChecklistTemplate, {
      id: published.id,
      tenantId: TENANT_A,
      name: "Forged rename",
      description: null,
      sections: null,
      version: published.version,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    await runWithTenant(TENANT_A, () => handler(msg));
    expect(await auditOutcomes(published.id)).toContain("rejected_status_published");
    expect((await getTemplate(published.id)).name).toBe("Exporter readiness v3");
  });

  it("a submit command against a completed instance is audited as not open", async () => {
    const subject = randomUUID();
    const instance = await raiseInstance("b2b_onboarding_live", "account", subject);
    expect((await answer(instance.id, [{ questionId: "gstin", value: "27AAAAA0000A1Z5" }])).statusCode).toBe(202);
    const completed = await getInstance(instance.id);
    expect(completed.status).toBe("completed");

    const handler = captureHandlers().handlerFor(COMMANDS.submitChecklistResponses);
    const msg = envelope(COMMANDS.submitChecklistResponses, {
      id: instance.id,
      tenantId: TENANT_A,
      responses: { gstin: { value: "forged", answeredAt: new Date().toISOString() } },
      version: completed.version,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    await runWithTenant(TENANT_A, () => handler(msg));

    expect(await auditOutcomes(instance.id)).toContain("rejected_instance_not_open");
    expect((await getInstance(instance.id)).responses.gstin?.value).toBe("27AAAAA0000A1Z5");
  });

  it("a second open instance for one subject is audited, not inserted", async () => {
    const subject = randomUUID();
    const first = await raiseInstance("b2b_onboarding_live", "contact", subject);

    // Forge the command the route refuses with 409, to prove the partial unique index and
    // the consumer's ON CONFLICT are what actually hold the invariant.
    const forgedId = randomUUID();
    const handler = captureHandlers().handlerFor(COMMANDS.createChecklistInstance);
    const msg = envelope(COMMANDS.createChecklistInstance, {
      id: forgedId,
      tenantId: TENANT_A,
      subjectType: "contact",
      subjectId: subject,
      templateId: first.templateId,
      templateKey: first.templateKey,
      templateVersionNumber: first.templateVersionNumber,
      structure: first.structure,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    await runWithTenant(TENANT_A, () => handler(msg));

    expect(await auditOutcomes(forgedId)).toContain("rejected_open_instance_exists");
    const list = (await call(
      "GET",
      `/v1/crm/checklist-instances?limit=200&subjectId=${subject}`,
    )).json().data as InstanceView[];
    expect(list).toHaveLength(1);
  });

  it("a deprecate command against an already deprecated template is audited by status", async () => {
    const created = await createTemplate({
      templateKey: "doomed_draft",
      name: "Doomed",
      sections: B2B_SECTIONS,
    });
    expect(created.statusCode).toBe(202);
    const draft = await templateVersion("doomed_draft", 1);
    expect((await call("POST", `/v1/crm/checklist-templates/${draft.id}/deprecate`, { payload: {} })).statusCode).toBe(202);
    const gone = await getTemplate(draft.id);
    expect(gone.status).toBe("deprecated");

    const handler = captureHandlers().handlerFor(COMMANDS.deprecateChecklistTemplate);
    const msg = envelope(COMMANDS.deprecateChecklistTemplate, {
      id: draft.id,
      tenantId: TENANT_A,
      version: gone.version,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    await runWithTenant(TENANT_A, () => handler(msg));
    expect(await auditOutcomes(draft.id)).toContain("rejected_status_deprecated");
  });

  it("a publish command for an unknown template is audited as not found", async () => {
    const handler = captureHandlers().handlerFor(COMMANDS.publishChecklistTemplate);
    const ghost = randomUUID();
    const msg = envelope(COMMANDS.publishChecklistTemplate, {
      id: ghost,
      tenantId: TENANT_A,
      templateKey: "ghost_key",
      versionNumber: 1,
      version: 1,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    await runWithTenant(TENANT_A, () => handler(msg));
    expect(await auditOutcomes(ghost)).toContain("rejected_not_found");
  });

  it("a duplicate template version command is audited, not inserted twice", async () => {
    const existing = await templateVersion("b2b_onboarding", 1);
    const handler = captureHandlers().handlerFor(COMMANDS.createChecklistTemplate);
    const msg = envelope(COMMANDS.createChecklistTemplate, {
      id: randomUUID(),
      tenantId: TENANT_A,
      templateKey: existing.templateKey,
      name: "Collides on version 1",
      description: null,
      sections: B2B_SECTIONS,
      versionNumber: 1,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    await runWithTenant(TENANT_A, () => handler(msg));

    const versions = await listTemplates("b2b_onboarding");
    expect(versions.filter((t) => t.versionNumber === 1)).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("G7 tenant isolation", () => {
  it("tenant B cannot see tenant A's templates or instances", async () => {
    const bHeaders = headers(["crm_admin"], TENANT_B, ACTOR_B);
    expect(await listTemplates(undefined, bHeaders)).toEqual([]);

    const instances = await call("GET", "/v1/crm/checklist-instances?limit=200", { headers: bHeaders });
    expect(instances.statusCode).toBe(200);
    expect(instances.json().data).toEqual([]);
  });

  it("tenant B reading tenant A's template by id gets 404, not 403", async () => {
    const template = await templateVersion("exporter_readiness", 3);
    const res = await call("GET", `/v1/crm/checklist-templates/${template.id}`, {
      headers: headers(["crm_admin"], TENANT_B, ACTOR_B),
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot answer tenant A's checklist", async () => {
    const list = (await call(
      "GET",
      `/v1/crm/checklist-instances?limit=200&subjectId=${SUBJECT_CASE}`,
    )).json().data as InstanceView[];
    const id = (list[0] as InstanceView).id;
    const res = await call("POST", `/v1/crm/checklist-instances/${id}/responses`, {
      headers: headers(["crm_admin"], TENANT_B, ACTOR_B),
      payload: { answers: [{ questionId: "gstin", value: "forged" }] },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("G7 route contract — every endpoint answers 400 / 401 / 403 / 404", () => {
  const READ_ONLY = headers(["crm_user"]);
  const NO_CRM = headers(["employee"]);

  it("GET /v1/crm/checklist-templates", async () => {
    expect((await call("GET", "/v1/crm/checklist-templates?limit=200")).statusCode).toBe(200);
    expect((await call("GET", "/v1/crm/checklist-templates?limit=0")).statusCode).toBe(400);
    expect((await call("GET", "/v1/crm/checklist-templates", { noAuth: true })).statusCode).toBe(401);
    expect((await call("GET", "/v1/crm/checklist-templates", { headers: NO_CRM })).statusCode).toBe(403);
    // A collection endpoint has no addressable resource to miss; the nearest 404 is an
    // unmatched path under the same prefix, asserted so a routing typo still shows up.
    expect((await call("GET", "/v1/crm/checklist-templates/nope/extra")).statusCode).toBe(404);
  });

  it("POST /v1/crm/checklist-templates", async () => {
    const ok = await createTemplate({
      templateKey: "contract_only_key",
      name: "Contract fixture",
      sections: B2B_SECTIONS,
    });
    expect(ok.statusCode).toBe(202);
    expect((await createTemplate({ templateKey: "no_name" })).statusCode).toBe(400);
    expect((await call("POST", "/v1/crm/checklist-templates", { noAuth: true, payload: {} })).statusCode).toBe(401);
    // Authoring a template is configuration: a plain CRM user is refused.
    expect((await createTemplate({ templateKey: "x", name: "X", sections: [] }, READ_ONLY)).statusCode).toBe(403);
    expect((await call("POST", "/v1/crm/checklist-templates/nope/extra", { payload: {} })).statusCode).toBe(404);
  });

  it("GET /v1/crm/checklist-templates/:id", async () => {
    const template = await templateVersion("contract_only_key", 1);
    expect((await call("GET", `/v1/crm/checklist-templates/${template.id}`)).statusCode).toBe(200);
    expect((await call("GET", "/v1/crm/checklist-templates/not-a-uuid")).statusCode).toBe(400);
    expect((await call("GET", `/v1/crm/checklist-templates/${template.id}`, { noAuth: true })).statusCode).toBe(401);
    expect((await call("GET", `/v1/crm/checklist-templates/${template.id}`, { headers: NO_CRM })).statusCode).toBe(403);
    expect((await call("GET", `/v1/crm/checklist-templates/${MISSING}`)).statusCode).toBe(404);
  });

  it("PATCH /v1/crm/checklist-templates/:id", async () => {
    const template = await templateVersion("contract_only_key", 1);
    expect((await call("PATCH", `/v1/crm/checklist-templates/${template.id}`, {
      payload: { description: "amended" },
    })).statusCode).toBe(202);
    // No amendable field named at all.
    expect((await call("PATCH", `/v1/crm/checklist-templates/${template.id}`, { payload: {} })).statusCode).toBe(400);
    expect((await call("PATCH", `/v1/crm/checklist-templates/${template.id}`, {
      noAuth: true, payload: { name: "x" },
    })).statusCode).toBe(401);
    expect((await call("PATCH", `/v1/crm/checklist-templates/${template.id}`, {
      headers: READ_ONLY, payload: { name: "x" },
    })).statusCode).toBe(403);
    expect((await call("PATCH", `/v1/crm/checklist-templates/${MISSING}`, {
      payload: { name: "x" },
    })).statusCode).toBe(404);
  });

  it("POST /v1/crm/checklist-templates/:id/publish", async () => {
    const template = await templateVersion("contract_only_key", 1);
    expect((await call("POST", `/v1/crm/checklist-templates/${template.id}/publish`, {
      payload: { version: 0 },
    })).statusCode).toBe(400);
    expect((await call("POST", `/v1/crm/checklist-templates/${template.id}/publish`, {
      noAuth: true, payload: {},
    })).statusCode).toBe(401);
    expect((await call("POST", `/v1/crm/checklist-templates/${template.id}/publish`, {
      headers: READ_ONLY, payload: {},
    })).statusCode).toBe(403);
    expect((await call("POST", `/v1/crm/checklist-templates/${MISSING}/publish`, {
      payload: {},
    })).statusCode).toBe(404);
    // Happy path last: it moves the row out of draft.
    expect((await call("POST", `/v1/crm/checklist-templates/${template.id}/publish`, {
      payload: {},
    })).statusCode).toBe(202);
    expect((await getTemplate(template.id)).status).toBe("published");
  });

  it("POST /v1/crm/checklist-templates/:id/deprecate", async () => {
    const template = await templateVersion("contract_only_key", 1);
    expect((await call("POST", `/v1/crm/checklist-templates/${template.id}/deprecate`, {
      payload: { version: 0 },
    })).statusCode).toBe(400);
    expect((await call("POST", `/v1/crm/checklist-templates/${template.id}/deprecate`, {
      noAuth: true, payload: {},
    })).statusCode).toBe(401);
    expect((await call("POST", `/v1/crm/checklist-templates/${template.id}/deprecate`, {
      headers: READ_ONLY, payload: {},
    })).statusCode).toBe(403);
    expect((await call("POST", `/v1/crm/checklist-templates/${MISSING}/deprecate`, {
      payload: {},
    })).statusCode).toBe(404);
    expect((await call("POST", `/v1/crm/checklist-templates/${template.id}/deprecate`, {
      payload: {},
    })).statusCode).toBe(202);
    expect((await getTemplate(template.id)).status).toBe("deprecated");
  });

  it("GET /v1/crm/checklist-instances", async () => {
    expect((await call("GET", "/v1/crm/checklist-instances?limit=200")).statusCode).toBe(200);
    expect((await call("GET", "/v1/crm/checklist-instances?limit=999")).statusCode).toBe(400);
    expect((await call("GET", "/v1/crm/checklist-instances", { noAuth: true })).statusCode).toBe(401);
    expect((await call("GET", "/v1/crm/checklist-instances", { headers: NO_CRM })).statusCode).toBe(403);
    expect((await call("GET", "/v1/crm/checklist-instances/nope/extra/deep")).statusCode).toBe(404);
  });

  it("POST /v1/crm/checklist-instances", async () => {
    const subject = randomUUID();
    expect((await call("POST", "/v1/crm/checklist-instances", {
      payload: { subjectType: "deal", subjectId: subject, templateKey: "b2b_onboarding_live" },
    })).statusCode).toBe(202);
    expect((await call("POST", "/v1/crm/checklist-instances", {
      payload: { subjectType: "deal", templateKey: "b2b_onboarding_live" },
    })).statusCode).toBe(400);
    expect((await call("POST", "/v1/crm/checklist-instances", {
      noAuth: true, payload: {},
    })).statusCode).toBe(401);
    expect((await call("POST", "/v1/crm/checklist-instances", {
      headers: NO_CRM,
      payload: { subjectType: "deal", subjectId: randomUUID(), templateKey: "b2b_onboarding_live" },
    })).statusCode).toBe(403);
    expect((await call("POST", "/v1/crm/checklist-instances", {
      payload: { subjectType: "deal", subjectId: randomUUID(), templateKey: "never_published" },
    })).statusCode).toBe(404);
  });

  it("GET /v1/crm/checklist-instances/:id", async () => {
    const instance = await raiseInstance("b2b_onboarding_live", "deal", randomUUID());
    expect((await call("GET", `/v1/crm/checklist-instances/${instance.id}`)).statusCode).toBe(200);
    expect((await call("GET", "/v1/crm/checklist-instances/not-a-uuid")).statusCode).toBe(400);
    expect((await call("GET", `/v1/crm/checklist-instances/${instance.id}`, { noAuth: true })).statusCode).toBe(401);
    expect((await call("GET", `/v1/crm/checklist-instances/${instance.id}`, { headers: NO_CRM })).statusCode).toBe(403);
    expect((await call("GET", `/v1/crm/checklist-instances/${MISSING}`)).statusCode).toBe(404);
  });

  it("POST /v1/crm/checklist-instances/:id/responses", async () => {
    const instance = await raiseInstance("b2b_onboarding_live", "deal", randomUUID());
    expect((await call("POST", `/v1/crm/checklist-instances/${instance.id}/responses`, {
      payload: { answers: [] },
    })).statusCode).toBe(400);
    expect((await call("POST", `/v1/crm/checklist-instances/${instance.id}/responses`, {
      noAuth: true, payload: { answers: [{ questionId: "gstin", value: "x" }] },
    })).statusCode).toBe(401);
    expect((await call("POST", `/v1/crm/checklist-instances/${instance.id}/responses`, {
      headers: NO_CRM, payload: { answers: [{ questionId: "gstin", value: "x" }] },
    })).statusCode).toBe(403);
    expect((await call("POST", `/v1/crm/checklist-instances/${MISSING}/responses`, {
      payload: { answers: [{ questionId: "gstin", value: "x" }] },
    })).statusCode).toBe(404);
    expect((await call("POST", `/v1/crm/checklist-instances/${instance.id}/responses`, {
      payload: { answers: [{ questionId: "gstin", value: "27AAAAA0000A1Z5" }] },
    })).statusCode).toBe(202);
  });

  it("GET /v1/crm/checklist-instances/:id/completion", async () => {
    const instance = await raiseInstance("b2b_onboarding_live", "deal", randomUUID());
    expect((await call("GET", `/v1/crm/checklist-instances/${instance.id}/completion`)).statusCode).toBe(200);
    expect((await call("GET", "/v1/crm/checklist-instances/not-a-uuid/completion")).statusCode).toBe(400);
    expect((await call("GET", `/v1/crm/checklist-instances/${instance.id}/completion`, {
      noAuth: true,
    })).statusCode).toBe(401);
    expect((await call("GET", `/v1/crm/checklist-instances/${instance.id}/completion`, {
      headers: NO_CRM,
    })).statusCode).toBe(403);
    expect((await call("GET", `/v1/crm/checklist-instances/${MISSING}/completion`)).statusCode).toBe(404);
  });
});
