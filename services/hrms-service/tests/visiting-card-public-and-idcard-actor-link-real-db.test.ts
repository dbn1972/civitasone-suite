/**
 * Issues #1776 + #1780 -- real DB (hrms_svc, NOBYPASSRLS, FORCE RLS), no mocks.
 *
 *  #1776  GET /v1/hrms/visiting-card/public/:token
 *         - keyed on an unguessable share token, never the employee number
 *         - exposes only minimal public vCard fields
 *         - the cross-tenant read is the narrow `public_share_read` policy: with the
 *           token GUC unset nothing is visible; with it set, exactly one card
 *         - per-route rate limit, uniform 404 for every miss, vCard injection-safe
 *  #1780  GET /v1/hrms/id-cards/me
 *         - resolves through resolveEmployeeForActor: deterministic, and 409 (never a
 *           guess) when the actor is linked to more than one employee row
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { encryptPii } from "../src/shared/pii-crypto.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET as string; // injected by vitest.config.ts
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ADMIN = randomUUID();
const DEPT = randomUUID();
const DESG = randomUUID();
const OWNER_USER = randomUUID();
const OWNER_EMP = randomUUID();
const OWNER_NO = `EMP-${OWNER_EMP.slice(0, 8)}`;
const OTHER_EMP = randomUUID();
const OTHER_USER = randomUUID();

const auth = (sub: string, tid = TENANT) => ({
  authorization: `Bearer ${signToken({ sub, tid, roles: ["employee"], sid: "sess-1776-1780" }, SECRET, 3600)}`,
});
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>, tid = TENANT) => withRawTenantGuc(sqlClient, tid, fn);

async function seedEmployee(id: string, no: string, name: string, userRef: string | null, tenant = TENANT, mobile = "9800000001") {
  await asTenant(async (tx) => {
    await tx`INSERT INTO employee.hrms_employees
               (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining,
                mobile, email, user_ref, created_by, updated_by)
             VALUES (${id}, ${tenant}, ${no}, ${name}, ${DEPT}, ${DESG}, '2020-01-15',
                     ${encryptPii(mobile)}, ${no.toLowerCase() + "@example.gov.in"}, ${userRef}, ${ADMIN}, ${ADMIN})`;
  }, tenant);
}

async function seedCard(employeeId: string, cardNo: string, status = "active") {
  const id = randomUUID();
  await asTenant((tx) => tx`
    INSERT INTO hrms.id_cards (id, tenant_id, holder_name, card_type, card_number, employee_id, valid_until, status, qr_payload, issued_by)
    VALUES (${id}, ${TENANT}, 'Holder', 'employee', ${cardNo}, ${employeeId}, '2030-01-01', ${status}, 'CVO1:x:x', ${ADMIN})`);
  return id;
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await asTenant(async (tx) => {
    await tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
             VALUES (${DEPT}, ${TENANT}, 'DIC', 'Digital India Corporation', ${ADMIN}, ${ADMIN})`;
    await tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
             VALUES (${DESG}, ${TENANT}, 'DIR', 'Director', ${ADMIN}, ${ADMIN})`;
  });
  await asTenant(async (tx) => {
    await tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
             VALUES (${randomUUID()}, ${OTHER_TENANT}, 'ZZ', 'Other Tenant Dept', ${ADMIN}, ${ADMIN})`;
  }, OTHER_TENANT);
  await seedEmployee(OWNER_EMP, OWNER_NO, "Asha Verma", OWNER_USER);
  await seedEmployee(OTHER_EMP, `EMP-${OTHER_EMP.slice(0, 8)}`, "Bhaskar Rao", OTHER_USER, TENANT, "9811111111");
  app = await buildApp();
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx`DELETE FROM hrms.id_cards WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM hrms.visiting_cards WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`;
  });
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${OTHER_TENANT}`, OTHER_TENANT);
  await app.close();
  await sqlClient.end();
});

const getPublic = (code: string, remoteAddress = "10.1.1.1") =>
  app.inject({ method: "GET", url: `/v1/hrms/visiting-card/public/${code}`, remoteAddress });
async function myToken(user = OWNER_USER): Promise<string> {
  const r = await app.inject({ method: "GET", url: "/v1/hrms/visiting-card/me", headers: auth(user) });
  expect(r.statusCode).toBe(200);
  const qr: string | null = r.json().data.qrUrl;
  return qr ? qr.split("/").pop()! : "";
}

describe("#1776 public visiting card -- share token", () => {
  it("/me qrUrl carries a 256-bit token and never the employee number", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/visiting-card/me", headers: auth(OWNER_USER) });
    const qr: string = r.json().data.qrUrl;
    const tok = qr.split("/").pop()!;
    expect(tok).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(qr).not.toContain(OWNER_NO);
    // stable across calls (not re-minted on every GET)
    expect(await myToken()).toBe(tok);
  });

  it("a valid token returns a 200 vCard with ONLY the minimal public fields", async () => {
    await app.inject({
      method: "PATCH", url: "/v1/hrms/visiting-card/me", headers: auth(OWNER_USER),
      payload: { suffix: "IAS", tagline: "MeitY", address: "Electronics Niketan, 6 CGO Complex", altEmail: "asha.home@example.org", altPhone: "9700000002", website: "https://example.gov.in" },
    });
    const r = await getPublic(await myToken());
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/vcard");
    expect(r.headers["cache-control"]).toBe("no-store");
    const v = r.body;
    expect(v).toContain("FN:Asha Verma, IAS");
    expect(v).toContain("TITLE:Director");
    expect(v).toContain("ORG:Digital India Corporation");
    expect(v).toContain(`EMAIL;TYPE=WORK:${OWNER_NO.toLowerCase()}@example.gov.in`);
    expect(v).toContain("URL:https://example.gov.in");
    // withheld: address, alt email, phones (show_personal_phone = false), ids, employee number
    expect(v).not.toContain("ADR");
    expect(v).not.toContain("asha.home");
    expect(v).not.toContain("TEL");
    expect(v).not.toContain("9800000001");
    expect(v).not.toContain(OWNER_NO);
    expect(v).not.toContain(OWNER_EMP);
    expect(v).not.toContain(TENANT);
    expect(v).not.toContain("PHOTO");
  });

  it("phones appear only after the owner opts in (show_personal_phone)", async () => {
    await app.inject({ method: "PATCH", url: "/v1/hrms/visiting-card/me", headers: auth(OWNER_USER), payload: { showPersonalPhone: true } });
    const r = await getPublic(await myToken());
    expect(r.body).toContain("TEL;TYPE=WORK:9800000001");
    expect(r.body).toContain("TEL;TYPE=CELL:9700000002");
    expect(r.body).not.toContain("enc:v");
    await app.inject({ method: "PATCH", url: "/v1/hrms/visiting-card/me", headers: auth(OWNER_USER), payload: { showPersonalPhone: false } });
  });

  it("a mobile that fails to decrypt is omitted, never leaked as ciphertext", async () => {
    await asTenant((tx) => tx`UPDATE employee.hrms_employees SET mobile = 'enc:v2:nokey:AAAA' WHERE id = ${OWNER_EMP}`);
    await app.inject({ method: "PATCH", url: "/v1/hrms/visiting-card/me", headers: auth(OWNER_USER), payload: { showPersonalPhone: true } });
    const r = await getPublic(await myToken());
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain("enc:v");
    expect(r.body).not.toContain("TEL;TYPE=WORK");
    await app.inject({ method: "PATCH", url: "/v1/hrms/visiting-card/me", headers: auth(OWNER_USER), payload: { showPersonalPhone: false } });
    await asTenant((tx) => tx`UPDATE employee.hrms_employees SET mobile = ${encryptPii("9800000001")} WHERE id = ${OWNER_EMP}`);
  });

  it("the employee number (and any guessable / malformed / unknown value) never resolves -- uniform 404", async () => {
    await myToken();
    const bodies = new Set<string>();
    for (const code of [OWNER_NO, OWNER_EMP, "1", "A".repeat(43), "A".repeat(44), "%27%20OR%201%3D1--", randomUUID()]) {
      const r = await getPublic(code);
      expect(r.statusCode).toBe(404);
      bodies.add(r.body);
    }
    expect(bodies.size).toBe(1);
  });

  it("increments scan_count on a hit", async () => {
    const before = (await asTenant((tx) => tx`SELECT scan_count FROM hrms.visiting_cards WHERE employee_id = ${OWNER_EMP}`))[0].scan_count;
    expect((await getPublic(await myToken())).statusCode).toBe(200);
    const after = (await asTenant((tx) => tx`SELECT scan_count FROM hrms.visiting_cards WHERE employee_id = ${OWNER_EMP}`))[0].scan_count;
    expect(after).toBe(before + 1);
  });

  it("rotate invalidates the old link; revoke 404s everything and /me does not silently re-issue", async () => {
    const oldTok = await myToken();
    const rot = await app.inject({ method: "POST", url: "/v1/hrms/visiting-card/me/share-token", headers: auth(OWNER_USER) });
    expect(rot.statusCode).toBe(200);
    const newTok: string = rot.json().data.qrUrl.split("/").pop();
    expect(newTok).not.toBe(oldTok);
    expect((await getPublic(oldTok)).statusCode).toBe(404);
    expect((await getPublic(newTok)).statusCode).toBe(200);

    const rev = await app.inject({ method: "DELETE", url: "/v1/hrms/visiting-card/me/share-token", headers: auth(OWNER_USER) });
    expect(rev.statusCode).toBe(200);
    expect((await getPublic(newTok)).statusCode).toBe(404);
    expect(await myToken()).toBe(""); // qrUrl null: revoked stays revoked
    // explicit re-issue works again
    const re = await app.inject({ method: "POST", url: "/v1/hrms/visiting-card/me/share-token", headers: auth(OWNER_USER) });
    expect((await getPublic(re.json().data.qrUrl.split("/").pop())).statusCode).toBe(200);
  });

  it("a separated employee's card stops resolving", async () => {
    const tok = await myToken();
    await asTenant((tx) => tx`UPDATE employee.hrms_employees SET status = 'separated' WHERE id = ${OWNER_EMP}`);
    expect((await getPublic(tok)).statusCode).toBe(404);
    await asTenant((tx) => tx`UPDATE employee.hrms_employees SET status = 'probation' WHERE id = ${OWNER_EMP}`);
    expect((await getPublic(tok)).statusCode).toBe(200);
  });

  it("vCard values cannot inject extra properties (CR/LF, ';', ',')", async () => {
    await app.inject({
      method: "PATCH", url: "/v1/hrms/visiting-card/me", headers: auth(OWNER_USER),
      payload: { displayName: "Evil\r\nTEL:999\r\nEND:VCARD", suffix: "A;B,C" },
    });
    const r = await getPublic(await myToken());
    expect(r.statusCode).toBe(200);
    const lines = r.body.split("\r\n");
    expect(lines.filter((l) => l.startsWith("TEL"))).toHaveLength(0);
    expect(lines.filter((l) => l === "END:VCARD")).toHaveLength(1);
    expect(r.headers["content-disposition"]).not.toMatch(/[\r\n]/);
    expect(r.headers["content-disposition"]).toContain('filename="Evil_TEL_999_END_VCARD.vcf"');
    await app.inject({ method: "PATCH", url: "/v1/hrms/visiting-card/me", headers: auth(OWNER_USER), payload: { displayName: "Asha Verma", suffix: "IAS" } });
  });

  it("the policy is narrow: no token => nothing visible; token => exactly one card/employee, no other tenant", async () => {
    const tok = await myToken();
    const counts = await sqlClient.begin(async (tx) => {
      const none = await tx`SELECT (SELECT count(*) FROM hrms.visiting_cards)::int AS c,
                                   (SELECT count(*) FROM employee.hrms_employees)::int AS e,
                                   (SELECT count(*) FROM employee.hrms_departments)::int AS d`;
      await tx`SELECT set_config('app.visiting_card_token', ${tok}, true)`;
      const one = await tx`SELECT (SELECT count(*) FROM hrms.visiting_cards)::int AS c,
                                  (SELECT count(*) FROM employee.hrms_employees)::int AS e,
                                  (SELECT count(*) FROM employee.hrms_departments)::int AS d`;
      // the bypass is read-only
      let writeBlocked = false;
      try { await tx`SAVEPOINT s`; await tx`UPDATE hrms.visiting_cards SET tagline = 'x'`; const n = await tx`SELECT count(*)::int AS n FROM hrms.visiting_cards WHERE tagline = 'x'`; writeBlocked = n[0].n === 0; await tx`ROLLBACK TO s`; } catch { writeBlocked = true; }
      return { none: none[0], one: one[0], writeBlocked };
    });
    expect(counts.none).toEqual({ c: 0, e: 0, d: 0 });
    expect(counts.one).toEqual({ c: 1, e: 1, d: 1 });
    expect(counts.writeBlocked).toBe(true);
  });

  it("is rate limited per client IP (route-level config) without throttling other IPs", async () => {
    const ip = "10.77.0.1";
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await getPublic("B".repeat(43), ip)).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 404)).toBe(true);
    expect(codes.slice(20)).toEqual([429, 429]);
    expect((await getPublic("B".repeat(43), "10.77.0.2")).statusCode).toBe(404);
  });
});

describe("#1780 GET /v1/hrms/id-cards/me -- actor-link resolver", () => {
  it("a uniquely linked actor gets their own active card", async () => {
    const cardId = await seedCard(OWNER_EMP, `T1780/${randomUUID().slice(0, 8)}`);
    const r = await app.inject({ method: "GET", url: "/v1/hrms/id-cards/me", headers: auth(OWNER_USER) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.id).toBe(cardId);
  });

  it("an actor with no linked employee gets 404 NOT_FOUND", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/id-cards/me", headers: auth(randomUUID()) });
    expect(r.statusCode).toBe(404);
  });

  it("an actor linked to TWO employees fails closed (409), whichever has the card -- never another employee's card", async () => {
    const dupUser = randomUUID();
    const a = randomUUID(), b = randomUUID();
    await seedEmployee(a, `DUP-${a.slice(0, 8)}`, "Dup One", dupUser);
    await new Promise((r) => setTimeout(r, 15));
    await seedEmployee(b, `DUP-${b.slice(0, 8)}`, "Dup Two", dupUser);
    const cardB = await seedCard(b, `T1780D/${randomUUID().slice(0, 8)}`);
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({ method: "GET", url: "/v1/hrms/id-cards/me", headers: auth(dupUser) });
      expect(r.statusCode).toBe(409);
      expect(r.json().code ?? r.json().error).toMatch(/AMBIGUOUS_EMPLOYEE_LINK/);
      expect(JSON.stringify(r.json())).not.toContain(cardB);
    }
  });

  it("does not leak across tenants: the same user_ref in another tenant is not a second link", async () => {
    const u = randomUUID();
    const e1 = randomUUID(), e2 = randomUUID();
    await seedEmployee(e1, `XT-${e1.slice(0, 8)}`, "Local", u);
    await asTenant(async (tx) => {
      await tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
               SELECT ${e2}, ${OTHER_TENANT}, ${"XT-" + e2.slice(0, 8)}, 'Foreign', d.id, ${randomUUID()}, '2020-01-01', ${u}, ${ADMIN}, ${ADMIN}
               FROM employee.hrms_departments d LIMIT 1`;
    }, OTHER_TENANT);
    const card = await seedCard(e1, `T1780X/${randomUUID().slice(0, 8)}`);
    const r = await app.inject({ method: "GET", url: "/v1/hrms/id-cards/me", headers: auth(u) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.id).toBe(card);
    await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${OTHER_TENANT}`, OTHER_TENANT);
  });
});
