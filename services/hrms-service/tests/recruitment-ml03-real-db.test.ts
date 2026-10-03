/**
 * ml-recruitment-03 -- real-Postgres regression suite:
 *  - TALENT-POOL-05: skill / minExp are filtered in SQL (a match older than the newest 2*limit rows
 *    used to be silently missed), and the response carries a real total + offset paging.
 *  - APPLICATION-05/06: GET /v1/hrms/applications/:id, tenant-scoped, DOB gated by role.
 *  - NEW-02: structured pay persists as bigint paise; min > max is a 400.
 *  - HOME-05: the job-opening list carries rosterStatus (one batched query) and feesMinor.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import postgres from "postgres";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import type { MemoryQueue } from "@civitasone/queue";
import { registerRecruitmentConsumers } from "../src/modules/recruitment/consumer.js";
import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";
import { seedHrmsCoreFixtures } from "./fixtures/core-seed.js";

registerRecruitmentConsumers(queue);
registerF3_recruitment_Consumers(queue);
async function drain(): Promise<void> {
  await (queue as unknown as MemoryQueue).drain();
}

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000f9";
const HR = "aaaaaaaa-e2e2-4000-8000-000000000011";
const DEPT_FIN = "eeeeeeee-0001-0000-0000-000000000001";
const CT = { "content-type": "application/json" };
const auth = (roles: string[] = ["hr_admin"], tid = TENANT) => ({ authorization: `Bearer ${signToken({ sub: HR, tid, roles, sid: "s" }, SECRET)}` });
const uniq = (l: string) => `${l}-${randomUUID().slice(0, 8)}`;

let app: FastifyInstance;
let db: postgres.Sql;

async function asTenant<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return db.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.tenant_id', '${TENANT}', true)`);
    return fn(tx);
  });
}

beforeAll(async () => {
  await seedHrmsCoreFixtures();
  db = postgres(process.env.DATABASE_URL ?? "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms", { max: 5 });
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await db.end({ timeout: 5 });
  await sqlClient.end();
});

async function createJob(extra: Record<string, unknown> = {}): Promise<string> {
  const r = await app.inject({
    method: "POST", url: "/v1/hrms/job-openings", headers: { ...auth(), ...CT },
    payload: { refNo: uniq("ML3"), title: "ML03 Test Role", departmentId: DEPT_FIN, vacancies: 2, ...extra },
  });
  expect(r.statusCode).toBe(202);
  const id = r.json().id as string;
  await drain();
  return id;
}

describe("TALENT-POOL-05 -- SQL filtering and real pagination", () => {
  it("finds a skill match that is OLDER than 2*limit newer rows (the JS-after-over-fetch bug missed it), and reports total", async () => {
    const jobId = await createJob();
    const rare = uniq("zzrare");
    // 450 newer rejected applications without the skill, then ONE oldest rejected application with it.
    await asTenant(async (tx) => {
      await tx`
        INSERT INTO recruitment.hrms_applications
          (id, tenant_id, job_opening_id, applicant_name, email, skills, experience_years, source, stage, status, applied_at, created_by, updated_by)
        SELECT gen_random_uuid(), ${TENANT}, ${jobId}, 'Filler ' || g, 'filler' || g || '@example.gov.in', ARRAY['common'], 1, 'internal', 'rejected', 'rejected',
               now() - (g || ' minutes')::interval, ${HR}, ${HR}
        FROM generate_series(1, 450) g`;
      await tx`
        INSERT INTO recruitment.hrms_applications
          (id, tenant_id, job_opening_id, applicant_name, email, skills, experience_years, source, stage, status, applied_at, created_by, updated_by)
        VALUES (gen_random_uuid(), ${TENANT}, ${jobId}, 'Oldest Rare', 'rare@example.gov.in', ARRAY[${rare}], 9, 'public_portal', 'rejected', 'rejected',
                now() - interval '400 days', ${HR}, ${HR})`;
    });

    const r = await app.inject({ method: "GET", url: `/v1/hrms/talent-pool?limit=200&skill=${rare.toUpperCase()}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { total: number; data: Array<{ applicantName: string }> };
    expect(body.total).toBe(1);
    expect(body.data.map((d) => d.applicantName)).toEqual(["Oldest Rare"]);
  });

  it("minExp is applied in SQL and the skill match treats % and _ literally", async () => {
    const jobId = await createJob();
    await asTenant(async (tx) => {
      await tx`
        INSERT INTO recruitment.hrms_applications
          (id, tenant_id, job_opening_id, applicant_name, email, skills, experience_years, source, stage, status, created_by, updated_by)
        VALUES
          (gen_random_uuid(), ${TENANT}, ${jobId}, 'Percent Skill', 'pct@example.gov.in', ARRAY['100%_safe'], 12, 'internal', 'withdrawn', 'withdrawn', ${HR}, ${HR}),
          (gen_random_uuid(), ${TENANT}, ${jobId}, 'Plain Skill',   'pln@example.gov.in', ARRAY['100xxsafe'], 12, 'internal', 'withdrawn', 'withdrawn', ${HR}, ${HR})`;
    });
    const lit = await app.inject({ method: "GET", url: `/v1/hrms/talent-pool?limit=50&skill=${encodeURIComponent("100%_safe")}&minExp=12`, headers: auth() });
    const names = (lit.json().data as Array<{ applicantName: string }>).map((d) => d.applicantName);
    expect(names).toContain("Percent Skill");
    expect(names).not.toContain("Plain Skill"); // '%' and '_' were not treated as wildcards

    const exp = await app.inject({ method: "GET", url: "/v1/hrms/talent-pool?limit=200&minExp=100", headers: auth() });
    expect(exp.json().total).toBe(0);
  });

  it("pages with limit/offset over a stable order and the total stays the same", async () => {
    const p1 = await app.inject({ method: "GET", url: "/v1/hrms/talent-pool?limit=5&offset=0&source=internal", headers: auth() });
    const p2 = await app.inject({ method: "GET", url: "/v1/hrms/talent-pool?limit=5&offset=5&source=internal", headers: auth() });
    const a = p1.json() as { total: number; offset: number; data: Array<{ id: string }> };
    const b = p2.json() as { total: number; offset: number; data: Array<{ id: string }> };
    expect(a.total).toBeGreaterThan(5);
    expect(b.total).toBe(a.total);
    expect(b.offset).toBe(5);
    expect(a.data).toHaveLength(5);
    const ids = new Set([...a.data, ...b.data].map((d) => d.id));
    expect(ids.size).toBe(10); // no overlap between pages
  });

  it("still defaults to the off-pipeline stages only", async () => {
    const jobId = await createJob();
    const email = `${uniq("active")}@example.gov.in`;
    await asTenant((tx) => tx`
      INSERT INTO recruitment.hrms_applications (id, tenant_id, job_opening_id, applicant_name, email, source, stage, status, created_by, updated_by)
      VALUES (gen_random_uuid(), ${TENANT}, ${jobId}, 'Active Person', ${email}, 'internal', 'shortlisted', 'active', ${HR}, ${HR})`);
    const r = await app.inject({ method: "GET", url: "/v1/hrms/talent-pool?limit=200", headers: auth() });
    expect((r.json().data as Array<{ email: string }>).map((d) => d.email)).not.toContain(email);
  });
});

describe("APPLICATION-05/06 -- GET /v1/hrms/applications/:id", () => {
  async function seedApp(): Promise<{ jobId: string; appId: string }> {
    const jobId = await createJob();
    const appId = randomUUID();
    await asTenant((tx) => tx`
      INSERT INTO recruitment.hrms_applications (id, tenant_id, job_opening_id, applicant_name, email, mobile, category, date_of_birth, source, stage, status, created_by, updated_by)
      VALUES (${appId}, ${TENANT}, ${jobId}, 'Detail Person', 'detail@example.gov.in', NULL, 'OBC', '1995-04-12', 'internal', 'applied', 'active', ${HR}, ${HR})`);
    return { jobId, appId };
  }

  it("200 for hr_admin with DOB and category; hr_officer gets DOB null", async () => {
    const { jobId, appId } = await seedApp();
    const admin = await app.inject({ method: "GET", url: `/v1/hrms/applications/${appId}`, headers: auth(["hr_admin"]) });
    expect(admin.statusCode).toBe(200);
    expect(admin.json()).toMatchObject({ id: appId, jobOpeningId: jobId, category: "OBC", dateOfBirth: "1995-04-12" });
    const officer = await app.inject({ method: "GET", url: `/v1/hrms/applications/${appId}`, headers: auth(["hr_officer"]) });
    expect(officer.statusCode).toBe(200);
    expect(officer.json().dateOfBirth).toBeNull();
    expect(officer.body).not.toContain("1995-04-12");
  });

  it("403 for a manager, 404 for a foreign-tenant caller, 404 for an unknown id", async () => {
    const { appId } = await seedApp();
    expect((await app.inject({ method: "GET", url: `/v1/hrms/applications/${appId}`, headers: auth(["manager"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/v1/hrms/applications/${appId}`, headers: auth(["hr_admin"], OTHER_TENANT) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/hrms/applications/${randomUUID()}`, headers: auth() })).statusCode).toBe(404);
  });
});

describe("NEW-02 -- structured pay", () => {
  it("persists level and min/max as bigint paise", async () => {
    const jobId = await createJob({ payLevel: "10", payMinMinor: "5610000", payMaxMinor: "17750050", payRange: "Level 10" });
    const rows = await asTenant((tx) => tx`select pay_level, pay_min_minor::text as mn, pay_max_minor::text as mx from recruitment.hrms_job_openings where id = ${jobId}`);
    expect(rows[0]).toMatchObject({ pay_level: "10", mn: "5610000", mx: "17750050" });
  });

  it("rejects min above max with a 400 and writes nothing", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/job-openings", headers: { ...auth(), ...CT },
      payload: { refNo: uniq("BAD"), title: "Bad pay", departmentId: DEPT_FIN, payMinMinor: "900", payMaxMinor: "100" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("the DB CHECK also refuses an inverted range", async () => {
    const jobId = await createJob();
    await expect(asTenant((tx) => tx`update recruitment.hrms_job_openings set pay_min_minor = 500, pay_max_minor = 100 where id = ${jobId}`)).rejects.toThrow(/pay_range_order/);
  });
});

describe("HOME-05 -- roster status and fee on the job-opening list", () => {
  it("returns rosterStatus (none / draft / approved) and feesMinor per row", async () => {
    const withRoster = await createJob();
    const without = await createJob();
    await asTenant((tx) => tx`
      INSERT INTO recruitment.hrms_reservation_rosters (id, tenant_id, job_opening_id, total_vacancies, status, created_by, updated_by)
      VALUES (gen_random_uuid(), ${TENANT}, ${withRoster}, 2, 'approved', ${HR}, ${HR})`);
    await asTenant((tx) => tx`update recruitment.hrms_job_openings set fees_minor = 10000 where id = ${withRoster}`);
    const r = await app.inject({ method: "GET", url: "/v1/hrms/job-openings?limit=100", headers: auth() });
    expect(r.statusCode).toBe(200);
    const rows = r.json() as Array<{ id: string; rosterStatus: string; feesMinor: string | null }>;
    const a = rows.find((x) => x.id === withRoster);
    const b = rows.find((x) => x.id === without);
    expect(a).toMatchObject({ rosterStatus: "approved", feesMinor: "10000" });
    expect(b).toMatchObject({ rosterStatus: "none", feesMinor: null });
  });
});
