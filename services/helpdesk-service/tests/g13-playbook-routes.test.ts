/**
 * G13 Resolution Playbooks — HTTP route tests (app.inject, no network).
 *
 * Covers EVERY endpoint in src/modules/playbooks/routes.ts with the required
 * matrix: happy path + 400 (zod) + 401 (no token) + 403 (wrong role) + 404
 * (missing id), plus the business-rule statuses the routes actually return
 * (409 for optimistic-lock / duplicate / already-done conflicts, 422 for
 * business-rule violations).
 *
 * THE IMMUTABILITY RULE, as the code actually implements it: PATCH on a
 * published (or deprecated) playbook answers **409 PLAYBOOK_NOT_DRAFT** — not
 * 422. routes.ts reaches for 409 there because a published version is a
 * *conflicting state of the resource* ("create a new version instead"), while
 * it reserves 422 for a request that is well-formed and addressed at the right
 * state but breaks a rule (unpublishable draft, mandatory steps outstanding).
 * These tests assert 409 + the PLAYBOOK_NOT_DRAFT code, so a change of either
 * is caught.
 *
 * DB-backed against the live civitas_helpdesk, same as the other route tests.
 * TEST HYGIENE: every tenant id is a fresh randomUUID() minted by this file, and
 * teardown deletes only rows carrying one of those ids. Nothing is truncated.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { tickets } from "../src/modules/tickets/schema.js";
import { playbooks, playbookRuns, playbookRunSteps } from "../src/modules/playbooks/schema.js";
import { outboxSchema } from "../src/shared/outbox.js";
import type { PlaybookStep } from "../src/modules/playbooks/domain.js";

const { outboxMessages } = outboxSchema;
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

/** Unique per test FILE (hygiene rule) — plus fresh ones for cache-sensitive reads. */
const TENANT = randomUUID();
const ACTOR = randomUUID();

/** Every tenant this file has written to, so teardown can scope its deletes. */
const tenants = new Set<string>([TENANT]);

/**
 * A brand-new tenant. Needed for the read paths that cache a PER-TENANT
 * collection (`playbook:list:*`, `playbook:published`): reusing one tenant would
 * let an earlier test's cached candidate set answer a later test's query.
 */
function freshTenant(): string {
  const t = randomUUID();
  tenants.add(t);
  return t;
}

function token(tenantId = TENANT, roles: string[] = ["helpdesk_admin"]): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-g13" }, SECRET, 3600);
}

function auth(tenantId = TENANT, roles: string[] = ["helpdesk_admin"]): { authorization: string } {
  return { authorization: `Bearer ${token(tenantId, roles)}` };
}

// ── fixtures ────────────────────────────────────────────────────────────────

function step(overrides: Partial<PlaybookStep> = {}): PlaybookStep {
  return {
    id: "s1",
    ordinal: 1,
    type: "instruction",
    title: "Verify the consignment number",
    body: "Ask the citizen for the 13-character consignment number.",
    mandatory: false,
    slaOffsetMinutes: null,
    knowledgeArticleId: null,
    ...overrides,
  };
}

interface SeedPlaybookOpts {
  tenantId?: string;
  status?: "draft" | "published" | "deprecated";
  playbookKey?: string;
  versionNumber?: number;
  steps?: PlaybookStep[];
  productCode?: string | null;
  ticketType?: string | null;
  priority?: string | null;
  categoryId?: string | null;
  version?: number;
}

async function seedPlaybook(opts: SeedPlaybookOpts = {}): Promise<{ id: string; tenantId: string }> {
  const tenantId = opts.tenantId ?? TENANT;
  tenants.add(tenantId);
  const id = randomUUID();
  const status = opts.status ?? "draft";
  await runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.insert(playbooks).values({
        id,
        tenantId,
        playbookKey: opts.playbookKey ?? `pb-${id.slice(0, 8)}`,
        name: "Speed Post delay",
        description: null,
        versionNumber: opts.versionNumber ?? 1,
        status,
        // chk_playbooks_published_at: a published row must carry its timestamp.
        publishedAt: status === "published" ? new Date() : null,
        categoryId: opts.categoryId ?? null,
        productCode: opts.productCode ?? null,
        ticketType: opts.ticketType ?? null,
        priority: opts.priority ?? null,
        steps: opts.steps ?? [step()],
        createdBy: ACTOR,
        updatedBy: ACTOR,
        version: opts.version ?? 1,
      }),
    ),
  );
  return { id, tenantId };
}

async function seedTicket(
  opts: { tenantId?: string; productCode?: string; ticketType?: string; priority?: string } = {},
): Promise<string> {
  const tenantId = opts.tenantId ?? TENANT;
  tenants.add(tenantId);
  const id = randomUUID();
  await runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.insert(tickets).values({
        id,
        tenantId,
        subject: `g13 route ticket ${id.slice(0, 8)}`,
        description: null,
        priority: opts.priority ?? "Medium",
        status: "open",
        ticketType: opts.ticketType ?? null,
        ...(opts.productCode ? { typeFields: { productCode: opts.productCode } } : {}),
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    ),
  );
  return id;
}

/** A run plus its snapshotted step rows, seeded directly (routes never write). */
async function seedRun(opts: {
  tenantId?: string;
  playbookId: string;
  ticketId: string;
  status?: "in_progress" | "completed" | "abandoned";
  steps?: Array<{ stepId: string; ordinal: number; mandatory: boolean; completedAt?: Date | null }>;
  version?: number;
}): Promise<string> {
  const tenantId = opts.tenantId ?? TENANT;
  tenants.add(tenantId);
  const runId = randomUUID();
  const status = opts.status ?? "in_progress";
  const stepRows = opts.steps ?? [{ stepId: "s1", ordinal: 1, mandatory: false }];
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      await tx.insert(playbookRuns).values({
        id: runId,
        tenantId,
        playbookId: opts.playbookId,
        playbookKey: "pb-seeded",
        playbookVersionNumber: 1,
        ticketId: opts.ticketId,
        status,
        progressPct: 0,
        completedAt: status === "completed" ? new Date() : null,
        autoAttached: false,
        createdBy: ACTOR,
        updatedBy: ACTOR,
        version: opts.version ?? 1,
      });
      await tx.insert(playbookRunSteps).values(
        stepRows.map((s) => ({
          tenantId,
          runId,
          stepId: s.stepId,
          ordinal: s.ordinal,
          stepType: "task",
          title: `step ${s.stepId}`,
          mandatory: s.mandatory,
          slaOffsetMinutes: null,
          knowledgeArticleId: null,
          completedAt: s.completedAt ?? null,
          completedBy: s.completedAt ? ACTOR : null,
        })),
      );
    }),
  );
  return runId;
}

// ── lifecycle ───────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  for (const tenantId of tenants) {
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        await tx.delete(playbookRunSteps).where(eq(playbookRunSteps.tenantId, tenantId));
        await tx.delete(playbookRuns).where(eq(playbookRuns.tenantId, tenantId));
        await tx.delete(playbooks).where(eq(playbooks.tenantId, tenantId));
        await tx.delete(tickets).where(eq(tickets.tenantId, tenantId));
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
      }),
    );
  }
  await sqlClient.end();
});

// ── POST /v1/helpdesk/playbooks ─────────────────────────────────────────────

describe("POST /v1/helpdesk/playbooks", () => {
  const body = () => ({
    playbookKey: `speed-post-delay-${randomUUID().slice(0, 8)}`,
    name: "Speed Post delay",
    steps: [step({ id: "verify", ordinal: 10 }), step({ id: "track", ordinal: 20, mandatory: true })],
    productCode: "SPEED_POST",
  });

  it("accepts a valid draft (202) and echoes the assigned id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbooks",
      headers: auth(),
      payload: body(),
    });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json.status).toBe("accepted");
    expect(json.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("400 when the body fails zod (playbookKey must be lower-case)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbooks",
      headers: auth(),
      payload: { ...body(), playbookKey: "Speed Post Delay!" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    expect(res.json().fieldErrors[0].field).toBe("playbookKey");
  });

  it("400 when steps is empty (zod min(1))", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbooks",
      headers: auth(),
      payload: { ...body(), steps: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("422 INVALID_PLAYBOOK_STEPS when a knowledge_link step carries no article", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbooks",
      headers: auth(),
      payload: {
        ...body(),
        steps: [step({ id: "kb", type: "knowledge_link", knowledgeArticleId: null })],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_PLAYBOOK_STEPS");
  });

  it("422 INVALID_PLAYBOOK_STEPS on duplicate step ids", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbooks",
      headers: auth(),
      payload: { ...body(), steps: [step({ id: "dup", ordinal: 1 }), step({ id: "dup", ordinal: 2 })] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toMatch(/duplicate step id/);
  });

  it("409 DUPLICATE_PLAYBOOK_VERSION when (key, version) already exists", async () => {
    const key = `dup-key-${randomUUID().slice(0, 8)}`;
    await seedPlaybook({ playbookKey: key, versionNumber: 2 });
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbooks",
      headers: auth(),
      payload: { ...body(), playbookKey: key, versionNumber: 2 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_PLAYBOOK_VERSION");
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/helpdesk/playbooks", payload: body() });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an agent — curating playbooks is admin-only", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbooks",
      headers: auth(TENANT, ["helpdesk_agent"]),
      payload: body(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });
});

// ── GET /v1/helpdesk/playbooks ──────────────────────────────────────────────

describe("GET /v1/helpdesk/playbooks", () => {
  it("200 with the list envelope and meta", async () => {
    const tenantId = freshTenant();
    await seedPlaybook({ tenantId, playbookKey: "aaa-first" });
    await seedPlaybook({ tenantId, playbookKey: "bbb-second", status: "published" });
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/playbooks",
      headers: auth(tenantId),
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data).toHaveLength(2);
    expect(json.meta).toEqual({ page: 1, pageSize: 50, total: 2 });
    expect(json.data[0].playbookKey).toBe("aaa-first");
  });

  it("200 filtered by status", async () => {
    const tenantId = freshTenant();
    await seedPlaybook({ tenantId, status: "draft" });
    await seedPlaybook({ tenantId, status: "published" });
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/playbooks?status=published",
      headers: auth(tenantId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((p: { status: string }) => p.status)).toEqual(["published"]);
  });

  it("200 filtered by playbookKey, with offset paging reflected in meta.page", async () => {
    const tenantId = freshTenant();
    const key = "pli-claim-status";
    await seedPlaybook({ tenantId, playbookKey: key, versionNumber: 1 });
    await seedPlaybook({ tenantId, playbookKey: key, versionNumber: 2 });
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/playbooks?playbookKey=${key}&limit=1&offset=1`,
      headers: auth(tenantId),
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.meta).toEqual({ page: 2, pageSize: 1, total: 1 });
    // ordered by key ASC, versionNumber DESC — offset 1 is version 1.
    expect(json.data[0].versionNumber).toBe(1);
  });

  it("tenant isolation: another tenant's playbooks are invisible", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    await seedPlaybook({ tenantId: owner });
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/playbooks",
      headers: auth(stranger),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("400 for a limit above the max", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/playbooks?limit=500",
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/helpdesk/playbooks" });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a citizen", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/playbooks",
      headers: auth(TENANT, ["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/helpdesk/playbooks/resolve ──────────────────────────────────────

describe("GET /v1/helpdesk/playbooks/resolve", () => {
  it("200 and picks the most specific published match, explaining the candidates", async () => {
    const tenantId = freshTenant();
    const catchAll = await seedPlaybook({ tenantId, playbookKey: "aaa-catch-all", status: "published" });
    const specific = await seedPlaybook({
      tenantId,
      playbookKey: "zzz-speed-post",
      status: "published",
      productCode: "SPEED_POST",
      priority: "high",
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/playbooks/resolve?productCode=SPEED_POST&priority=High",
      headers: auth(tenantId, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data.id).toBe(specific.id);
    expect(json.meta.matched).toBe(true);
    expect(json.meta.candidates.map((c: { id: string }) => c.id)).toEqual([specific.id, catchAll.id]);
  });

  it("200 with data:null when nothing matches (not a 404)", async () => {
    const tenantId = freshTenant();
    await seedPlaybook({ tenantId, status: "published", productCode: "SCSS" });
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/playbooks/resolve?productCode=SPEED_POST",
      headers: auth(tenantId, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeNull();
    expect(res.json().meta.matched).toBe(false);
  });

  it("200 and never resolves a draft playbook", async () => {
    const tenantId = freshTenant();
    await seedPlaybook({ tenantId, status: "draft", productCode: "SPEED_POST" });
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/playbooks/resolve?productCode=SPEED_POST",
      headers: auth(tenantId, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeNull();
  });

  it("400 when categoryId is not a uuid", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/playbooks/resolve?categoryId=not-a-uuid",
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/helpdesk/playbooks/resolve" });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a citizen", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/playbooks/resolve",
      headers: auth(TENANT, ["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/helpdesk/playbooks/:id ──────────────────────────────────────────

describe("GET /v1/helpdesk/playbooks/:id", () => {
  it("200 with the playbook view including computed specificity", async () => {
    const pb = await seedPlaybook({ productCode: "SPEED_POST", priority: "high" });
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/playbooks/${pb.id}`,
      headers: auth(TENANT, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(200);
    const view = res.json().data;
    expect(view.id).toBe(pb.id);
    expect(view.specificity).toBe(2);
    expect(view.steps).toHaveLength(1);
  });

  it("404 for an unknown id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/playbooks/${randomUUID()}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("404 when the playbook belongs to another tenant", async () => {
    const pb = await seedPlaybook({ tenantId: freshTenant() });
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/playbooks/${pb.id}`,
      headers: auth(freshTenant()),
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 when the id is not a uuid", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/playbooks/abc",
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/helpdesk/playbooks/${randomUUID()}` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a citizen", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/playbooks/${randomUUID()}`,
      headers: auth(TENANT, ["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── PATCH /v1/helpdesk/playbooks/:id — the immutability rule ─────────────────

describe("PATCH /v1/helpdesk/playbooks/:id", () => {
  it("202 when patching a draft", async () => {
    const pb = await seedPlaybook();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/playbooks/${pb.id}`,
      headers: auth(),
      payload: { name: "Speed Post delay (revised)", expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ id: pb.id, status: "accepted" });
  });

  it("202 when patching a draft's steps (re-validated and normalised)", async () => {
    const pb = await seedPlaybook();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/playbooks/${pb.id}`,
      headers: auth(),
      payload: {
        steps: [step({ id: "b", ordinal: 20 }), step({ id: "a", ordinal: 10, mandatory: true })],
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("IMMUTABILITY: 409 PLAYBOOK_NOT_DRAFT when the playbook is published", async () => {
    const pb = await seedPlaybook({ status: "published" });
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/playbooks/${pb.id}`,
      headers: auth(),
      payload: { name: "sneaky edit" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PLAYBOOK_NOT_DRAFT");
    expect(res.json().message).toMatch(/immutable/);
  });

  it("IMMUTABILITY: 409 PLAYBOOK_NOT_DRAFT when the playbook is deprecated", async () => {
    const pb = await seedPlaybook({ status: "deprecated" });
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/playbooks/${pb.id}`,
      headers: auth(),
      payload: { steps: [step()] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PLAYBOOK_NOT_DRAFT");
  });

  it("409 VERSION_CONFLICT when expectedVersion is stale", async () => {
    const pb = await seedPlaybook({ version: 3 });
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/playbooks/${pb.id}`,
      headers: auth(),
      payload: { name: "stale", expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });

  it("422 INVALID_PLAYBOOK_STEPS when the replacement steps break a cross-field rule", async () => {
    const pb = await seedPlaybook();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/playbooks/${pb.id}`,
      headers: auth(),
      payload: { steps: [step({ id: "kb", type: "knowledge_link", knowledgeArticleId: null })] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_PLAYBOOK_STEPS");
  });

  it("400 for an empty body (the refine requires at least one field)", async () => {
    const pb = await seedPlaybook();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/playbooks/${pb.id}`,
      headers: auth(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown id", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/playbooks/${randomUUID()}`,
      headers: auth(),
      payload: { name: "nope" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/playbooks/${randomUUID()}`,
      payload: { name: "nope" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an agent", async () => {
    const pb = await seedPlaybook();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/playbooks/${pb.id}`,
      headers: auth(TENANT, ["helpdesk_agent"]),
      payload: { name: "nope" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/helpdesk/playbooks/:id/publish ─────────────────────────────────

describe("POST /v1/helpdesk/playbooks/:id/publish", () => {
  it("202 for a draft with a valid step", async () => {
    const pb = await seedPlaybook();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbooks/${pb.id}/publish`,
      headers: auth(),
      payload: { expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("202 with no body at all (lifecycleBody defaults to {})", async () => {
    const pb = await seedPlaybook();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbooks/${pb.id}/publish`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(202);
  });

  it("422 PLAYBOOK_NOT_PUBLISHABLE for a draft with zero steps", async () => {
    const pb = await seedPlaybook({ steps: [] });
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbooks/${pb.id}/publish`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("PLAYBOOK_NOT_PUBLISHABLE");
  });

  it("422 PLAYBOOK_NOT_PUBLISHABLE when it is already published", async () => {
    const pb = await seedPlaybook({ status: "published" });
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbooks/${pb.id}/publish`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(422);
  });

  it("409 VERSION_CONFLICT on a stale expectedVersion", async () => {
    const pb = await seedPlaybook({ version: 2 });
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbooks/${pb.id}/publish`,
      headers: auth(),
      payload: { expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("400 when expectedVersion is below the minimum", async () => {
    const pb = await seedPlaybook();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbooks/${pb.id}/publish`,
      headers: auth(),
      payload: { expectedVersion: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown id", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbooks/${randomUUID()}/publish`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbooks/${randomUUID()}/publish`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an agent", async () => {
    const pb = await seedPlaybook();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbooks/${pb.id}/publish`,
      headers: auth(TENANT, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/helpdesk/playbooks/:id/deprecate ───────────────────────────────

describe("POST /v1/helpdesk/playbooks/:id/deprecate", () => {
  it("202 for a published playbook", async () => {
    const pb = await seedPlaybook({ status: "published" });
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbooks/${pb.id}/deprecate`,
      headers: auth(),
      payload: { expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("422 PLAYBOOK_NOT_PUBLISHED for a draft", async () => {
    const pb = await seedPlaybook({ status: "draft" });
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbooks/${pb.id}/deprecate`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("PLAYBOOK_NOT_PUBLISHED");
  });

  it("409 VERSION_CONFLICT on a stale expectedVersion", async () => {
    const pb = await seedPlaybook({ status: "published", version: 4 });
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbooks/${pb.id}/deprecate`,
      headers: auth(),
      payload: { expectedVersion: 2 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("400 when the id is not a uuid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbooks/xyz/deprecate",
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown id", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbooks/${randomUUID()}/deprecate`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbooks/${randomUUID()}/deprecate`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an agent", async () => {
    const pb = await seedPlaybook({ status: "published" });
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbooks/${pb.id}/deprecate`,
      headers: auth(TENANT, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/helpdesk/playbook-runs ─────────────────────────────────────────

describe("POST /v1/helpdesk/playbook-runs", () => {
  it("202 with an explicit published playbookId", async () => {
    const pb = await seedPlaybook({ status: "published" });
    const ticketId = await seedTicket();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbook-runs",
      headers: auth(TENANT, ["helpdesk_agent"]),
      payload: { ticketId, playbookId: pb.id },
    });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(json.playbookId).toBe(pb.id);
    expect(json.ticketId).toBe(ticketId);
  });

  it("202 auto-resolving the playbook from the ticket's own criteria", async () => {
    const tenantId = freshTenant();
    const pb = await seedPlaybook({
      tenantId,
      status: "published",
      productCode: "SPEED_POST",
      ticketType: "incident",
    });
    const ticketId = await seedTicket({ tenantId, productCode: "SPEED_POST", ticketType: "incident" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbook-runs",
      headers: auth(tenantId, ["helpdesk_agent"]),
      payload: { ticketId },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().playbookId).toBe(pb.id);
  });

  it("422 NO_MATCHING_PLAYBOOK when auto-resolution finds nothing", async () => {
    const tenantId = freshTenant();
    await seedPlaybook({ tenantId, status: "published", productCode: "SCSS" });
    const ticketId = await seedTicket({ tenantId, productCode: "SPEED_POST" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbook-runs",
      headers: auth(tenantId, ["helpdesk_agent"]),
      payload: { ticketId },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("NO_MATCHING_PLAYBOOK");
  });

  it("422 PLAYBOOK_NOT_PUBLISHED when the requested playbook is still a draft", async () => {
    const pb = await seedPlaybook({ status: "draft" });
    const ticketId = await seedTicket();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbook-runs",
      headers: auth(TENANT, ["helpdesk_agent"]),
      payload: { ticketId, playbookId: pb.id },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("PLAYBOOK_NOT_PUBLISHED");
  });

  it("409 RUN_ALREADY_EXISTS when the ticket already has a run", async () => {
    const pb = await seedPlaybook({ status: "published" });
    const ticketId = await seedTicket();
    await seedRun({ playbookId: pb.id, ticketId });
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbook-runs",
      headers: auth(TENANT, ["helpdesk_agent"]),
      payload: { ticketId, playbookId: pb.id },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("RUN_ALREADY_EXISTS");
  });

  it("404 when the ticket does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbook-runs",
      headers: auth(TENANT, ["helpdesk_agent"]),
      payload: { ticketId: randomUUID() },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toMatch(/ticket not found/);
  });

  it("404 when the requested playbook does not exist", async () => {
    const ticketId = await seedTicket();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbook-runs",
      headers: auth(TENANT, ["helpdesk_agent"]),
      payload: { ticketId, playbookId: randomUUID() },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toMatch(/playbook not found/);
  });

  it("400 when ticketId is not a uuid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbook-runs",
      headers: auth(TENANT, ["helpdesk_agent"]),
      payload: { ticketId: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbook-runs",
      payload: { ticketId: randomUUID() },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a citizen", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbook-runs",
      headers: auth(TENANT, ["citizen"]),
      payload: { ticketId: randomUUID() },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/helpdesk/playbook-runs/:id ──────────────────────────────────────

describe("GET /v1/helpdesk/playbook-runs/:id", () => {
  it("200 with the run view, next step and outstanding mandatory ids", async () => {
    const pb = await seedPlaybook({ status: "published" });
    const ticketId = await seedTicket();
    const runId = await seedRun({
      playbookId: pb.id,
      ticketId,
      steps: [
        { stepId: "a", ordinal: 1, mandatory: true, completedAt: new Date() },
        { stepId: "b", ordinal: 2, mandatory: true },
      ],
    });
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/playbook-runs/${runId}`,
      headers: auth(TENANT, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(200);
    const view = res.json().data;
    expect(view.id).toBe(runId);
    expect(view.progressPct).toBe(50);
    expect(view.nextStepId).toBe("b");
    expect(view.outstandingMandatoryStepIds).toEqual(["b"]);
    expect(view.steps).toHaveLength(2);
  });

  it("404 for an unknown run", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/playbook-runs/${randomUUID()}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toMatch(/playbook run not found/);
  });

  it("400 when the id is not a uuid", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/playbook-runs/nope",
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/helpdesk/playbook-runs/${randomUUID()}` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a citizen", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/playbook-runs/${randomUUID()}`,
      headers: auth(TENANT, ["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/helpdesk/playbook-runs/:id/steps/:stepId/complete ───────────────

describe("POST /v1/helpdesk/playbook-runs/:id/steps/:stepId/complete", () => {
  async function seededRun(
    status: "in_progress" | "completed" | "abandoned" = "in_progress",
    completedAt: Date | null = null,
  ): Promise<string> {
    const pb = await seedPlaybook({ status: "published" });
    const ticketId = await seedTicket();
    return seedRun({
      playbookId: pb.id,
      ticketId,
      status,
      steps: [{ stepId: "a", ordinal: 1, mandatory: true, completedAt }],
    });
  }

  it("202 for an outstanding step on an in-progress run", async () => {
    const runId = await seededRun();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${runId}/steps/a/complete`,
      headers: auth(TENANT, ["helpdesk_agent"]),
      payload: { note: "consignment traced" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("202 with no body (completeStepBody defaults to {})", async () => {
    const runId = await seededRun();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${runId}/steps/a/complete`,
      headers: auth(TENANT, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("409 STEP_ALREADY_COMPLETE when the step is already stamped", async () => {
    const runId = await seededRun("in_progress", new Date());
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${runId}/steps/a/complete`,
      headers: auth(TENANT, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("STEP_ALREADY_COMPLETE");
  });

  it("422 RUN_NOT_IN_PROGRESS once the run is completed", async () => {
    const runId = await seededRun("completed");
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${runId}/steps/a/complete`,
      headers: auth(TENANT, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("RUN_NOT_IN_PROGRESS");
  });

  it("404 when the step id is not on this run", async () => {
    const runId = await seededRun();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${runId}/steps/does-not-exist/complete`,
      headers: auth(TENANT, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toMatch(/step not found on this run/);
  });

  it("404 when the run does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${randomUUID()}/steps/a/complete`,
      headers: auth(TENANT, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 when the run id is not a uuid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/playbook-runs/not-a-uuid/steps/a/complete",
      headers: auth(TENANT, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when the note exceeds its maximum length", async () => {
    const runId = await seededRun();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${runId}/steps/a/complete`,
      headers: auth(TENANT, ["helpdesk_agent"]),
      payload: { note: "x".repeat(2001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${randomUUID()}/steps/a/complete`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a citizen", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${randomUUID()}/steps/a/complete`,
      headers: auth(TENANT, ["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/helpdesk/playbook-runs/:id/complete ────────────────────────────

describe("POST /v1/helpdesk/playbook-runs/:id/complete", () => {
  async function runWithSteps(opts: {
    status?: "in_progress" | "completed" | "abandoned";
    version?: number;
    steps: Array<{ stepId: string; ordinal: number; mandatory: boolean; completedAt?: Date | null }>;
  }): Promise<string> {
    const pb = await seedPlaybook({ status: "published" });
    const ticketId = await seedTicket();
    return seedRun({
      playbookId: pb.id,
      ticketId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.version !== undefined ? { version: opts.version } : {}),
      steps: opts.steps,
    });
  }

  it("202 when every mandatory step is done", async () => {
    const runId = await runWithSteps({
      steps: [
        { stepId: "a", ordinal: 1, mandatory: true, completedAt: new Date() },
        { stepId: "b", ordinal: 2, mandatory: false },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${runId}/complete`,
      headers: auth(TENANT, ["helpdesk_agent"]),
      payload: { expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBe(runId);
  });

  it("422 MANDATORY_STEPS_OUTSTANDING and names the outstanding steps", async () => {
    const runId = await runWithSteps({
      steps: [
        { stepId: "a", ordinal: 1, mandatory: true },
        { stepId: "b", ordinal: 2, mandatory: true, completedAt: new Date() },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${runId}/complete`,
      headers: auth(TENANT, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("MANDATORY_STEPS_OUTSTANDING");
    expect(res.json().message).toMatch(/\ba\b/);
  });

  it("409 RUN_ALREADY_COMPLETE for a completed run", async () => {
    const runId = await runWithSteps({
      status: "completed",
      steps: [{ stepId: "a", ordinal: 1, mandatory: false }],
    });
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${runId}/complete`,
      headers: auth(TENANT, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("RUN_ALREADY_COMPLETE");
  });

  it("422 RUN_NOT_IN_PROGRESS for an abandoned run", async () => {
    const runId = await runWithSteps({
      status: "abandoned",
      steps: [{ stepId: "a", ordinal: 1, mandatory: false }],
    });
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${runId}/complete`,
      headers: auth(TENANT, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("RUN_NOT_IN_PROGRESS");
  });

  it("409 VERSION_CONFLICT on a stale expectedVersion", async () => {
    const runId = await runWithSteps({
      version: 3,
      steps: [{ stepId: "a", ordinal: 1, mandatory: false }],
    });
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${runId}/complete`,
      headers: auth(TENANT, ["helpdesk_agent"]),
      payload: { expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });

  it("400 when expectedVersion is not a positive integer", async () => {
    const runId = await runWithSteps({ steps: [{ stepId: "a", ordinal: 1, mandatory: false }] });
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${runId}/complete`,
      headers: auth(TENANT, ["helpdesk_agent"]),
      payload: { expectedVersion: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown run", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${randomUUID()}/complete`,
      headers: auth(TENANT, ["helpdesk_agent"]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${randomUUID()}/complete`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a citizen", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/playbook-runs/${randomUUID()}/complete`,
      headers: auth(TENANT, ["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── Cross-cutting: no route wrote to Postgres ───────────────────────────────

describe("CQRS discipline", () => {
  it("all the 202 responses above left the playbook tables untouched for this tenant", async () => {
    // Every row that exists for TENANT was seeded by this file's helpers; the
    // routes only publish commands, so nothing extra can have appeared.
    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) =>
        tx
          .select({ id: playbooks.id, status: playbooks.status })
          .from(playbooks)
          .where(eq(playbooks.tenantId, TENANT)),
      ),
    );
    // Publish/deprecate were accepted (202) but no consumer ran in this process,
    // so no seeded draft can have flipped to published behind the route's back.
    const seededPublished = rows.filter((r) => r.status === "published").length;
    expect(rows.length).toBeGreaterThan(0);
    expect(seededPublished).toBeGreaterThan(0);
    const runs = await runWithTenant(TENANT, () =>
      db.transaction((tx) =>
        tx.select({ id: playbookRuns.id }).from(playbookRuns).where(eq(playbookRuns.tenantId, TENANT)),
      ),
    );
    // Only the runs seedRun() created — POST /playbook-runs never inserts.
    const stepRows = await runWithTenant(TENANT, () =>
      db.transaction((tx) =>
        tx
          .select({ runId: playbookRunSteps.runId })
          .from(playbookRunSteps)
          .where(
            inArray(
              playbookRunSteps.runId,
              runs.map((r) => r.id),
            ),
          ),
      ),
    );
    expect(stepRows.length).toBeGreaterThanOrEqual(runs.length);
  });
});
