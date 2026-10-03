/**
 * GAP-PAYROLL-DISBURSEMENT-03 -- bank-file signing, end to end against a REAL
 * Postgres (migrated through 0075, run as the NOBYPASSRLS payroll_svc role),
 * through buildApp() and the real signing-settings consumer.
 *
 * Requires DATABASE_URL pointing at a disposable, migrated instance (see
 * vitest.config.ts REL-035). Keys are generated at test runtime.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import * as openpgp from "openpgp";
import { signToken } from "@civitasone/auth";
import type { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { makeTestProvider, type TestProvider } from "./fixtures/signing-test-provider.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const REASON = "Monthly salary NEFT batch for SBI";
const CHANGE_REASON = "Bank H2H channel requires PKCS7 detached signatures";

type Emp = { id: string; employeeNo: string; fullName: string; bankAccountNo: string; bankIfsc: string; netPayMinor: bigint };
const EMPLOYEES: Emp[] = [
  { id: randomUUID(), employeeNo: "SG-EMP-001", fullName: "Asha Rao", bankAccountNo: "123456789012", bankIfsc: "SBIN0001234", netPayMinor: 4523150n },
  { id: randomUUID(), employeeNo: "SG-EMP-002", fullName: "Vikram Singh", bankAccountNo: "998877665544", bankIfsc: "HDFC0000123", netPayMinor: 6100000n },
];
const PAYABLE_TOTAL = EMPLOYEES.reduce((s, e) => s + e.netPayMinor, 0n);

const H = vi.hoisted(() => ({ breakPgpVerify: false }));

vi.mock("../src/shared/hrms-client.js", () => ({
  fetchPayrollInput: vi.fn(async () => ({
    employees: EMPLOYEES.map((e) => ({
      id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, basicMinor: "0",
      payStructureId: null, bankAccountNo: e.bankAccountNo, bankIfsc: e.bankIfsc,
      pan: null, uan: null, cityClass: "X", taxRegime: "new", departmentId: null, pensionScheme: "NPS",
    })),
    lopDays: {},
  })),
  fetchPendingPayrollRuns: vi.fn(async () => 0),
  fetchEmployeeSummaries: vi.fn(async () => new Map()),
}));

vi.mock("../src/modules/sponsor-config/repo.js", () => ({
  findByTenantId: vi.fn(async (tenantId: string) => ({
    tenantId, sponsorCode: "SBIN", sponsorIfsc: "SBIN0000001", sponsorAccount: "00000011112222",
    utilityCode: "NACH00000000012", userNumber: "USR001", settlementOffsetDays: 1,
    nachEnabled: true, apbsEnabled: false, maxRecordsPerFile: 100000, maxAmountPerFileMinor: 100000000000n,
  })),
}));

// Real signers, except the PGP self-check can be forced to fail.
vi.mock("../src/modules/bank-file-signing/signers.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/modules/bank-file-signing/signers.js")>();
  return {
    ...real,
    verifyPgpDetached: vi.fn(async (...a: Parameters<typeof real.verifyPgpDetached>) =>
      H.breakPgpVerify ? { ok: false, hash: null } : real.verifyPgpDetached(...a)),
  };
});

const { db, sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerBankFileSigningConsumers } = await import("../src/modules/bank-file-signing/consumer.js");
const { setSigningKeyProviderForTests } = await import("../src/modules/bank-file-signing/key-provider.js");
const { setIntegrationEnvironmentResolver } = await import("../src/modules/bank-file-signing/environment.js");
const { pgpPublicKeyOf, verifyPgpDetached, verifyPkcs7Detached } = await import("../src/modules/bank-file-signing/signers.js");

{
  type Hd = (m: { tenantId: string }) => Promise<void>;
  const q = queue as unknown as { subscribe: (topic: string, h: Hd) => void };
  const raw = q.subscribe.bind(q);
  q.subscribe = (topic: string, h: Hd) => raw(topic, (m) => runWithTenant(m.tenantId, () => h(m)) as Promise<void>);
}
registerBankFileSigningConsumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

type TxRunner = { execute: (q: unknown) => Promise<unknown> };
const rowsOf = (r: unknown) => Array.from(r as Iterable<Record<string, unknown>>);
const scoped = <T,>(tenantId: string, fn: (tx: TxRunner) => Promise<T>): Promise<T> =>
  withTenantScope(db as never, tenantId, fn as never) as Promise<T>;
const token = (roles: string[], tenantId = TENANT) => signToken({ sub: ACTOR, tid: tenantId, roles, sid: "s1" }, SECRET);
const auth = (roles: string[], tenantId = TENANT) => ({ authorization: `Bearer ${token(roles, tenantId)}` });
const ADMIN = ["payroll_admin"];

let monthSeq = 0;
async function seedRun(tenantId: string): Promise<string> {
  const runId = randomUUID();
  const month = String(3000 + monthSeq++) + "-01";
  await scoped(tenantId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, total_net_minor, created_by, updated_by)
      VALUES (${runId}::uuid, ${tenantId}::uuid, ${"SG/" + runId.slice(0, 8)}, ${month}, ${randomUUID()}::uuid, 'approved',
              ${PAYABLE_TOTAL.toString()}::bigint, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    for (const e of EMPLOYEES) {
      await tx.execute(sql`
        INSERT INTO payroll.payroll_slips (tenant_id, run_id, employee_id, employee_no, gross_minor, net_pay_minor, status, created_by, updated_by)
        VALUES (${tenantId}::uuid, ${runId}::uuid, ${e.id}::uuid, ${e.employeeNo}, 100::bigint, ${e.netPayMinor.toString()}::bigint, 'computed', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    }
  });
  return runId;
}

const issuanceRows = (tenantId: string, runId: string) => scoped(tenantId, async (tx) => rowsOf(await tx.execute(sql`
  SELECT id, file_name, signature_format, signature, file_sha256, signed_at, signing_key_fingerprint, encrypted_to_bank
    FROM payroll.disbursement_file_issuances WHERE run_id = ${runId}::uuid ORDER BY seq`)));
const ledgerCount = (tenantId: string, runId: string) => scoped(tenantId, async (tx) =>
  Number(rowsOf(await tx.execute(sql`SELECT COUNT(*)::int AS n FROM payroll.disbursement_transfers WHERE run_id = ${runId}::uuid`))[0]!.n));
const auditRows = (tenantId: string, action: string, resourceId: string) => scoped(tenantId, async (tx) => rowsOf(await tx.execute(sql`
  SELECT payload FROM _outbox.messages
   WHERE tenant_id = ${tenantId}::uuid AND topic = 'audit.event.record' AND payload->>'action' = ${action}
     AND payload->>'resourceId' = ${resourceId} ORDER BY created_at`)));
const detailOf = (a: Record<string, unknown>) => (a.payload as { detail: Record<string, unknown> }).detail;

let app: FastifyInstance;
let provider: TestProvider;

const bankFile = (runId: string, format: "csv" | "nach" = "csv", tenantId = TENANT) => app.inject({
  method: "POST", url: `/v1/payroll/runs/${runId}/bank-file`,
  payload: { format, reason: REASON }, headers: auth(ADMIN, tenantId),
});
const putSigning = async (body: Record<string, unknown>, roles = ADMIN, tenantId = TENANT) => {
  const res = await app.inject({ method: "PUT", url: "/v1/payroll/bank-file-signing", payload: body, headers: auth(roles, tenantId) });
  await drain();
  return res;
};
const getSigning = (roles = ADMIN, tenantId = TENANT) => app.inject({ method: "GET", url: "/v1/payroll/bank-file-signing", headers: auth(roles, tenantId) });
const resetSigning = (tenantId = TENANT) => scoped(tenantId, (tx) =>
  tx.execute(sql`DELETE FROM payroll.payroll_settings WHERE tenant_id = ${tenantId}::uuid`));
const SIGNED_BODY = { format: "pgp_detached", encryptToBank: false, keyRef: "default" };

beforeAll(async () => {
  provider = await makeTestProvider({ withBankKey: true });
  setSigningKeyProviderForTests(provider);
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await queue.start();
});
afterAll(async () => {
  setSigningKeyProviderForTests(null);
  await queue.stop();
  await app?.close();
  await sqlClient.end();
});
beforeEach(async () => { H.breakPgpVerify = false; await resetSigning(); });
afterEach(() => { setIntegrationEnvironmentResolver(null); });

const PUB = () => pgpPublicKeyOf(provider.material.pgpPrivateKeyArmored);

describe("migrations 0073-0075 (real DB)", () => {
  it("add the columns, keep FORCE RLS on both tables, and are idempotent when re-applied", async () => {
    const dir = join(process.cwd(), "migrations");
    for (const f of ["0073_bank_file_signing_setting.sql", "0074_disbursement_file_signature.sql", "0075_disbursement_file_issuances_list_idx.sql"]) {
      await sqlClient.unsafe(readFileSync(join(dir, f), "utf8")); // second application
    }
    const cols = await sqlClient.unsafe(`SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema='payroll' AND ((table_name='payroll_settings' AND column_name='bank_file_signing')
          OR (table_name='disbursement_file_issuances' AND column_name IN
              ('signature_format','signature','file_sha256','signed_at','signing_key_fingerprint','encrypted_to_bank')))`);
    expect(cols).toHaveLength(7);
    const rls = await sqlClient.unsafe(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='payroll'
        AND relname IN ('payroll_settings','disbursement_file_issuances')`);
    expect(rls).toHaveLength(2);
    for (const r of rls) expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, true, true]);
    const idx = await sqlClient.unsafe(`SELECT 1 FROM pg_indexes WHERE schemaname='payroll' AND indexname='idx_disbursement_file_issuances_tenant_created'`);
    expect(idx).toHaveLength(1);
  });

  it("the CHECK constraints refuse inconsistent signature rows and a malformed setting", async () => {
    const runId = await seedRun(TENANT);
    const insert = (cols: string, vals: string) => scoped(TENANT, (tx) => tx.execute(sql.raw(`
      INSERT INTO payroll.disbursement_file_issuances
        (id, tenant_id, run_id, seq, mode, file_format, file_name, line_count, total_minor, reason, created_by ${cols})
      VALUES ('${randomUUID()}', '${TENANT}', '${runId}', 99, 'first', 'csv', 'x.csv', 1, 1, 'a reason text', '${ACTOR}' ${vals})`)));
    // pgp format without a signature
    await expect(insert(", signature_format", ", 'pgp_detached'")).rejects.toThrow();
    // signed format without sha256 / signed_at / fingerprint
    await expect(insert(", signature_format, signature", ", 'pgp_detached', 'sig'")).rejects.toThrow();
    // unknown format
    await expect(insert(", signature_format", ", 'rot13'")).rejects.toThrow();
    // xml_dsig / none never carry a detached signature
    await expect(insert(", signature_format, signature", ", 'none', 'sig'")).rejects.toThrow();
    // a consistent signed row is accepted
    await expect(insert(", signature_format, signature, file_sha256, signed_at, signing_key_fingerprint",
      `, 'pgp_detached', 'sig', '${"a".repeat(64)}', now(), 'FPR'`)).resolves.toBeDefined();
    // payroll_settings.bank_file_signing: missing keyRef / unknown format rejected
    const setting = (json: string) => scoped(TENANT, (tx) => tx.execute(sql.raw(`
      INSERT INTO payroll.payroll_settings (tenant_id, bank_file_signing) VALUES ('${TENANT}', '${json}'::jsonb)
      ON CONFLICT (tenant_id) DO UPDATE SET bank_file_signing = EXCLUDED.bank_file_signing`)));
    await expect(setting('{"format":"pgp_detached","encryptToBank":false}')).rejects.toThrow();
    await expect(setting('{"format":"md5","encryptToBank":false,"keyRef":"default"}')).rejects.toThrow();
    await expect(setting('{"format":"none","encryptToBank":false,"keyRef":"default"}')).resolves.toBeDefined();
  });

  it("RLS: another tenant cannot read this tenant's signature rows", async () => {
    const runId = await seedRun(TENANT);
    expect((await bankFile(runId)).statusCode).toBe(200);
    const seen = await scoped(OTHER_TENANT, async (tx) => rowsOf(await tx.execute(sql`SELECT id FROM payroll.disbursement_file_issuances WHERE run_id = ${runId}::uuid`)));
    expect(seen).toHaveLength(0);
  });
});

describe("default behaviour: signed (pgp_detached) with no setting at all", () => {
  it("POST bank-file signs by default: signed header, sha256 of the body, stored signature that verifies; a tampered file fails", async () => {
    const runId = await seedRun(TENANT);
    const res = await bankFile(runId);
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-bank-file-signed"]).toBe("true");
    expect(res.headers["x-bank-file-signature-format"]).toBe("pgp_detached");
    expect(res.headers["x-bank-file-encrypted"]).toBe("false");
    const body = res.rawPayload;
    expect(res.headers["x-bank-file-sha256"]).toBe(createHash("sha256").update(body).digest("hex"));

    const [iss] = await issuanceRows(TENANT, runId);
    expect(iss).toMatchObject({ signature_format: "pgp_detached", file_sha256: res.headers["x-bank-file-sha256"], encrypted_to_bank: false });
    expect(iss!.signed_at).toBeTruthy();
    expect(iss!.signing_key_fingerprint).toBe(provider.material.pgpFingerprint);
    expect(res.headers["x-bank-file-issuance-id"]).toBe(iss!.id);

    // the second download: the detached signature
    const sig = await app.inject({ method: "GET", url: `/v1/payroll/disbursement/files/${iss!.id}/signature`, headers: auth(["payroll_officer"]) });
    expect(sig.statusCode).toBe(200);
    expect(sig.headers["content-disposition"]).toBe(`attachment; filename="${iss!.file_name as string}.sig"`);
    expect(sig.headers["content-type"]).toContain("application/pgp-signature");
    expect(sig.body.startsWith("-----BEGIN PGP SIGNATURE-----")).toBe(true);
    expect((await verifyPgpDetached(body, sig.body, await PUB())).ok).toBe(true);

    const tampered = Buffer.from(body);
    tampered[tampered.length - 3] ^= 0x01;
    expect((await verifyPgpDetached(tampered, sig.body, await PUB())).ok).toBe(false);

    const audit = await auditRows(TENANT, "bank_file_generated", runId);
    expect(detailOf(audit[0]!)).toMatchObject({
      signed: true, signatureFormat: "pgp_detached", fileSha256: iss!.file_sha256, encryptedToBank: false,
      signingKeyFingerprint: provider.material.pgpFingerprint,
    });
  });

  it("NACH zip: the signature is over the exact zip bytes", async () => {
    const runId = await seedRun(TENANT);
    const res = await bankFile(runId, "nach");
    expect(res.statusCode).toBe(200);
    const [iss] = await issuanceRows(TENANT, runId);
    const sig = await app.inject({ method: "GET", url: `/v1/payroll/disbursement/files/${iss!.id}/signature`, headers: auth(ADMIN) });
    expect((await verifyPgpDetached(res.rawPayload, sig.body, await PUB())).ok).toBe(true);
    expect(res.headers["x-bank-file-sha256"]).toBe(createHash("sha256").update(res.rawPayload).digest("hex"));
  });

  it("GET /disbursement/files lists signed state; officers can read; employees cannot; tenants are isolated", async () => {
    const runId = await seedRun(TENANT);
    await bankFile(runId);
    const list = await app.inject({ method: "GET", url: `/v1/payroll/disbursement/files?runId=${runId}`, headers: auth(["payroll_officer"]) });
    expect(list.statusCode).toBe(200);
    const j = list.json() as { data: Array<Record<string, unknown>>; total: number };
    expect(j.total).toBe(1);
    expect(j.data[0]).toMatchObject({ runId, signed: true, signatureFormat: "pgp_detached", hasDetachedSignature: true, encryptedToBank: false, fileFormat: "csv" });
    expect(JSON.stringify(j)).not.toMatch(/BEGIN PGP/); // the list never carries the signature body
    expect((await app.inject({ method: "GET", url: "/v1/payroll/disbursement/files", headers: auth(["employee"]) })).statusCode).toBe(403);
    const other = await app.inject({ method: "GET", url: `/v1/payroll/disbursement/files?runId=${runId}`, headers: auth(ADMIN, OTHER_TENANT) });
    expect((other.json() as { total: number }).total).toBe(0);
    const iss = (await issuanceRows(TENANT, runId))[0]!;
    const cross = await app.inject({ method: "GET", url: `/v1/payroll/disbursement/files/${iss.id}/signature`, headers: auth(ADMIN, OTHER_TENANT) });
    expect(cross.statusCode).toBe(404);
  });

  it("bounds the list page size", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/payroll/disbursement/files?limit=100000", headers: auth(ADMIN) });
    expect(res.statusCode).toBe(400);
  });
});

describe("settings: role gate, CQRS consumer, audit before/after", () => {
  it("GET reports the default policy and key status (present, fingerprint) -- never key material", async () => {
    const res = await getSigning(["payroll_officer"]);
    expect(res.statusCode).toBe(200);
    const j = res.json() as Record<string, unknown>;
    expect(j).toMatchObject({
      isDefault: true,
      config: { format: "pgp_detached", encryptToBank: false, keyRef: "default", perBankOverrides: {} },
      key: { present: true, fingerprint: provider.material.pgpFingerprint },
    });
    expect(res.body).not.toMatch(/PRIVATE KEY|BEGIN PGP/);
  });

  it("only payroll_admin / super_admin may change it; every other role is 403 and nothing is stored", async () => {
    for (const roles of [["payroll_officer"], ["hr_officer"], ["employee"], ["finance_officer"]]) {
      const res = await putSigning(SIGNED_BODY, roles);
      expect(res.statusCode, roles.join()).toBe(403);
    }
    expect((await getSigning()).json()).toMatchObject({ isDefault: true });
    expect((await putSigning(SIGNED_BODY, ["super_admin"])).statusCode).toBe(202);
    expect((await getSigning(["employee"])).statusCode).toBe(403);
  });

  it("an admin change goes route -> command -> consumer, is stored, and audited with before (default=null) and after + reason", async () => {
    // earlier tests in this file already audited changes for the same tenant
    const priorAudits = (await auditRows(TENANT, "bank_file_signing_updated", TENANT)).length;
    const res = await putSigning({
      format: "pkcs7_detached", perBankOverrides: { HDFC: "pgp_detached" }, encryptToBank: true, keyRef: "default", reason: CHANGE_REASON,
    });
    expect(res.statusCode).toBe(202);
    const accepted = res.json() as { id: string; status: string };
    expect(accepted.status).toBe("accepted");
    const now = (await getSigning()).json() as { config: Record<string, unknown>; isDefault: boolean };
    expect(now.isDefault).toBe(false);
    expect(now.config).toMatchObject({ format: "pkcs7_detached", perBankOverrides: { HDFC: "pgp_detached" }, encryptToBank: true });

    const first = (await auditRows(TENANT, "bank_file_signing_updated", TENANT)).slice(priorAudits);
    expect(first).toHaveLength(1);
    expect(detailOf(first[0]!)).toMatchObject({
      before: null, reason: CHANGE_REASON,
      after: { format: "pkcs7_detached", perBankOverrides: { HDFC: "pgp_detached" }, encryptToBank: true, keyRef: "default" },
    });

    await putSigning({ ...SIGNED_BODY, reason: "Back to PGP after bank confirmed" });
    const all = (await auditRows(TENANT, "bank_file_signing_updated", TENANT)).slice(priorAudits);
    expect(all).toHaveLength(2);
    expect(detailOf(all[1]!)).toMatchObject({ before: { format: "pkcs7_detached", encryptToBank: true }, after: { format: "pgp_detached" } });
  });

  it("validation: bad keyRef / bank code / encrypt-with-none are 400 and publish nothing", async () => {
    expect((await putSigning({ ...SIGNED_BODY, keyRef: "../etc/passwd" })).statusCode).toBe(400);
    expect((await putSigning({ ...SIGNED_BODY, keyRef: "/abs/path" })).statusCode).toBe(400);
    expect((await putSigning({ ...SIGNED_BODY, keyRef: "a..b" })).statusCode).toBe(400);
    expect((await putSigning({ ...SIGNED_BODY, keyRef: "hsm:slot-1/payroll" })).statusCode).toBe(202);
    await resetSigning();
    expect((await putSigning({ ...SIGNED_BODY, perBankOverrides: { sbi: "pgp_detached" } })).statusCode).toBe(400);
    expect((await putSigning({ ...SIGNED_BODY, format: "none", encryptToBank: true })).statusCode).toBe(400);
    expect((await putSigning({ ...SIGNED_BODY, format: "rot13" })).statusCode).toBe(400);
    expect((await putSigning({ ...SIGNED_BODY, reason: "short" })).statusCode).toBe(400);
    expect((await getSigning()).json()).toMatchObject({ isDefault: true });
  });

  it("settings are per-tenant", async () => {
    await putSigning({ ...SIGNED_BODY, format: "pkcs7_detached" });
    expect((await getSigning(ADMIN, OTHER_TENANT)).json()).toMatchObject({ isDefault: true, config: { format: "pgp_detached" } });
  });

  it("'none' is rejected with 422 when the tenant's integration environment is production -- and not stored", async () => {
    setIntegrationEnvironmentResolver(async () => "production");
    const res = await putSigning({ ...SIGNED_BODY, format: "none" });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { code: string }).code).toBe("UNSIGNED_NOT_ALLOWED_IN_PRODUCTION");
    const ov = await putSigning({ ...SIGNED_BODY, perBankOverrides: { SBIN: "none" } });
    expect(ov.statusCode).toBe(422);
    expect((await getSigning()).json()).toMatchObject({ isDefault: true, production: true, unsignedAllowed: false });
  });
});

describe("other formats and policies through the real route", () => {
  it("pkcs7_detached: .p7s endpoint returns DER that verifies against the cert; header says pkcs7", async () => {
    await putSigning({ ...SIGNED_BODY, format: "pkcs7_detached" });
    const runId = await seedRun(TENANT);
    const res = await bankFile(runId);
    expect(res.headers["x-bank-file-signature-format"]).toBe("pkcs7_detached");
    const [iss] = await issuanceRows(TENANT, runId);
    const sig = await app.inject({ method: "GET", url: `/v1/payroll/disbursement/files/${iss!.id}/signature`, headers: auth(ADMIN) });
    expect(sig.headers["content-disposition"]).toContain(".p7s");
    expect(verifyPkcs7Detached(res.rawPayload, sig.rawPayload, provider.material.certPem)).toBe(true);
    const tampered = Buffer.from(res.rawPayload); tampered[5] ^= 1;
    expect(verifyPkcs7Detached(tampered, sig.rawPayload, provider.material.certPem)).toBe(false);
  });

  it("per-bank override (sponsor bank SBIN) beats the tenant default", async () => {
    await putSigning({ ...SIGNED_BODY, perBankOverrides: { SBIN: "pkcs7_detached" } });
    const runId = await seedRun(TENANT);
    const res = await bankFile(runId);
    expect(res.headers["x-bank-file-signature-format"]).toBe("pkcs7_detached");
    await putSigning({ ...SIGNED_BODY, perBankOverrides: { HDFC: "pkcs7_detached" } }); // other bank: not applied
    const res2 = await bankFile(await seedRun(TENANT));
    expect(res2.headers["x-bank-file-signature-format"]).toBe("pgp_detached");
  });

  it("encrypt-to-bank (opt-in): body is the .pgp of the file, decrypts to it; the stored signature verifies over the plaintext", async () => {
    await putSigning({ ...SIGNED_BODY, encryptToBank: true });
    const runId = await seedRun(TENANT);
    const res = await bankFile(runId);
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-bank-file-encrypted"]).toBe("true");
    expect(res.headers["content-disposition"]).toMatch(/\.csv\.pgp"$/);
    const dec = await openpgp.decrypt({
      message: await openpgp.readMessage({ binaryMessage: res.rawPayload }),
      decryptionKeys: await openpgp.readPrivateKey({ armoredKey: provider.bank!.privateKey }), format: "binary",
    });
    const plain = Buffer.from(dec.data as Uint8Array);
    expect(plain.toString("utf8")).toContain("TRAILER,2,,,");
    expect(res.headers["x-bank-file-sha256"]).toBe(createHash("sha256").update(plain).digest("hex"));
    const [iss] = await issuanceRows(TENANT, runId);
    expect(iss).toMatchObject({ encrypted_to_bank: true });
    // the ledger file reference is the plaintext name, not .pgp
    expect(iss!.file_name).toMatch(/\.csv$/);
    const sig = await app.inject({ method: "GET", url: `/v1/payroll/disbursement/files/${iss!.id}/signature`, headers: auth(ADMIN) });
    expect((await verifyPgpDetached(plain, sig.body, await PUB())).ok).toBe(true);
  });

  it("'none' in dev/sandbox: file issued, header says unsigned, no signature stored, signature endpoint 404", async () => {
    expect((await putSigning({ ...SIGNED_BODY, format: "none" })).statusCode).toBe(202);
    const runId = await seedRun(TENANT);
    const res = await bankFile(runId);
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-bank-file-signed"]).toBe("false");
    expect(res.headers["x-bank-file-signature-format"]).toBe("none");
    const [iss] = await issuanceRows(TENANT, runId);
    expect(iss).toMatchObject({ signature_format: "none", signature: null, signed_at: null });
    expect(iss!.file_sha256).toBe(res.headers["x-bank-file-sha256"]);
    const sig = await app.inject({ method: "GET", url: `/v1/payroll/disbursement/files/${iss!.id}/signature`, headers: auth(ADMIN) });
    expect(sig.statusCode).toBe(404);
    expect(detailOf((await auditRows(TENANT, "bank_file_generated", runId))[0]!)).toMatchObject({ signed: false, signatureFormat: "none" });
    const list = await app.inject({ method: "GET", url: `/v1/payroll/disbursement/files?runId=${runId}`, headers: auth(ADMIN) });
    expect((list.json() as { data: Array<{ signed: boolean }> }).data[0]!.signed).toBe(false);
  });

  it("a stored 'none' is REFUSED at issuance once the tenant is in production -- no file, no rows", async () => {
    await putSigning({ ...SIGNED_BODY, format: "none" });
    setIntegrationEnvironmentResolver(async () => "production");
    const runId = await seedRun(TENANT);
    const res = await bankFile(runId);
    expect(res.statusCode).toBe(422);
    expect((res.json() as { code: string }).code).toBe("UNSIGNED_NOT_ALLOWED_IN_PRODUCTION");
    expect(await issuanceRows(TENANT, runId)).toHaveLength(0);
    expect(await ledgerCount(TENANT, runId)).toBe(0);
  });

  it("xml_dsig on a CSV file fails closed (422): no file, no ledger rows, no issuance", async () => {
    await putSigning({ ...SIGNED_BODY, format: "xml_dsig" });
    const runId = await seedRun(TENANT);
    const res = await bankFile(runId);
    expect(res.statusCode).toBe(422);
    expect((res.json() as { code: string }).code).toBe("SIGNING_FORMAT_NOT_APPLICABLE");
    expect(await issuanceRows(TENANT, runId)).toHaveLength(0);
    expect(await ledgerCount(TENANT, runId)).toBe(0);
  });

  it("encrypt-to-bank without a bank key: 422, nothing issued", async () => {
    const noBank = await makeTestProvider();
    setSigningKeyProviderForTests(noBank);
    try {
      await putSigning({ ...SIGNED_BODY, encryptToBank: true });
      const runId = await seedRun(TENANT);
      const res = await bankFile(runId);
      expect(res.statusCode).toBe(422);
      expect((res.json() as { code: string }).code).toBe("SIGNING_RECIPIENT_KEY_MISSING");
      expect(await ledgerCount(TENANT, runId)).toBe(0);
    } finally { setSigningKeyProviderForTests(provider); }
  });

  it("production keystore stub: 503 NOT_IMPLEMENTED, never an unsigned file", async () => {
    const { KeystoreSigningKeyProvider } = await import("../src/modules/bank-file-signing/key-provider.js");
    setSigningKeyProviderForTests(new KeystoreSigningKeyProvider());
    try {
      const runId = await seedRun(TENANT);
      const res = await bankFile(runId);
      expect(res.statusCode).toBe(503);
      expect((res.json() as { code: string }).code).toBe("SIGNING_NOT_IMPLEMENTED");
      expect(await issuanceRows(TENANT, runId)).toHaveLength(0);
      expect(await ledgerCount(TENANT, runId)).toBe(0);
    } finally { setSigningKeyProviderForTests(provider); }
  });

  it("PAYROLL_INTEGRATION_ENVIRONMENT=production (NODE_ENV=test) selects the keystore stub: issuance is 503 SIGNING_NOT_IMPLEMENTED, nothing recorded", async () => {
    setSigningKeyProviderForTests(null); // use the real selection logic
    vi.stubEnv("PAYROLL_INTEGRATION_ENVIRONMENT", "production");
    try {
      expect(process.env.NODE_ENV).not.toBe("production");
      const runId = await seedRun(TENANT);
      const res = await bankFile(runId);
      expect(res.statusCode).toBe(503);
      expect((res.json() as { code: string }).code).toBe("SIGNING_NOT_IMPLEMENTED");
      expect(await issuanceRows(TENANT, runId)).toHaveLength(0);
      expect(await ledgerCount(TENANT, runId)).toBe(0);
    } finally {
      vi.unstubAllEnvs();
      setSigningKeyProviderForTests(provider);
    }
  });

  it("the three GET endpoints are Cache-Control: no-store (policy, files list, signature)", async () => {
    const runId = await seedRun(TENANT);
    await bankFile(runId);
    const iss = (await issuanceRows(TENANT, runId))[0]!;
    for (const url of ["/v1/payroll/bank-file-signing", "/v1/payroll/disbursement/files", `/v1/payroll/disbursement/files/${iss.id}/signature`]) {
      const res = await app.inject({ method: "GET", url, headers: auth(ADMIN) });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["cache-control"], url).toBe("no-store");
    }
  });

  it("SELF-CHECK failure fails closed: 500, the file is not returned, nothing is recorded or audited; the next attempt succeeds", async () => {
    const runId = await seedRun(TENANT);
    H.breakPgpVerify = true;
    const res = await bankFile(runId);
    expect(res.statusCode).toBe(500);
    expect((res.json() as { code: string }).code).toBe("SIGNING_SELF_CHECK_FAILED");
    expect(res.headers["x-bank-file-signed"]).toBeUndefined();
    expect(res.body).not.toContain("TRAILER");
    expect(await issuanceRows(TENANT, runId)).toHaveLength(0);
    expect(await ledgerCount(TENANT, runId)).toBe(0);
    expect(await auditRows(TENANT, "bank_file_generated", runId)).toHaveLength(0);
    H.breakPgpVerify = false;
    expect((await bankFile(runId)).statusCode).toBe(200);
    expect(await ledgerCount(TENANT, runId)).toBe(2);
  });
});
